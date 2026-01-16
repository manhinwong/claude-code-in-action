import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

vi.mock("jose", () => ({
  SignJWT: vi.fn(),
  jwtVerify: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

const mockSignJWT = {
  setProtectedHeader: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  setIssuedAt: vi.fn().mockReturnThis(),
  sign: vi.fn().mockResolvedValue("mock-jwt-token"),
};

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue(mockCookieStore as never);
    vi.mocked(SignJWT).mockImplementation(() => mockSignJWT as never);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("createSession", () => {
    test("creates a JWT with correct payload and sets cookie", async () => {
      const { createSession } = await import("@/lib/auth");

      await createSession("user-123", "test@example.com");

      expect(SignJWT).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          email: "test@example.com",
          expiresAt: expect.any(Date),
        })
      );
      expect(mockSignJWT.setProtectedHeader).toHaveBeenCalledWith({
        alg: "HS256",
      });
      expect(mockSignJWT.setExpirationTime).toHaveBeenCalledWith("7d");
      expect(mockSignJWT.setIssuedAt).toHaveBeenCalled();
      expect(mockSignJWT.sign).toHaveBeenCalled();
    });

    test("sets cookie with correct options", async () => {
      const { createSession } = await import("@/lib/auth");

      await createSession("user-123", "test@example.com");

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        "mock-jwt-token",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          expires: expect.any(Date),
        })
      );
    });

    test("sets expiration date 7 days in the future", async () => {
      const { createSession } = await import("@/lib/auth");
      const beforeCall = Date.now();

      await createSession("user-123", "test@example.com");

      const afterCall = Date.now();
      const cookieCall = mockCookieStore.set.mock.calls[0];
      const expiresAt = cookieCall[2].expires as Date;

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        beforeCall + sevenDaysMs
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(afterCall + sevenDaysMs);
    });

    test("uses HS256 algorithm for JWT signing", async () => {
      const { createSession } = await import("@/lib/auth");

      await createSession("user-123", "test@example.com");

      expect(mockSignJWT.setProtectedHeader).toHaveBeenCalledWith({
        alg: "HS256",
      });
    });

    test("calls JWT methods in correct chain order", async () => {
      const { createSession } = await import("@/lib/auth");
      const callOrder: string[] = [];

      mockSignJWT.setProtectedHeader.mockImplementation(() => {
        callOrder.push("setProtectedHeader");
        return mockSignJWT;
      });
      mockSignJWT.setExpirationTime.mockImplementation(() => {
        callOrder.push("setExpirationTime");
        return mockSignJWT;
      });
      mockSignJWT.setIssuedAt.mockImplementation(() => {
        callOrder.push("setIssuedAt");
        return mockSignJWT;
      });
      mockSignJWT.sign.mockImplementation(() => {
        callOrder.push("sign");
        return Promise.resolve("mock-jwt-token");
      });

      await createSession("user-123", "test@example.com");

      expect(callOrder).toEqual([
        "setProtectedHeader",
        "setExpirationTime",
        "setIssuedAt",
        "sign",
      ]);
    });

    test("handles different user IDs and emails", async () => {
      const { createSession } = await import("@/lib/auth");

      await createSession("uuid-abc-123", "another@test.org");

      expect(SignJWT).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "uuid-abc-123",
          email: "another@test.org",
        })
      );
    });

    test("stores generated token in cookie", async () => {
      mockSignJWT.sign.mockResolvedValue("custom-generated-token");
      const { createSession } = await import("@/lib/auth");

      await createSession("user-123", "test@example.com");

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        "custom-generated-token",
        expect.any(Object)
      );
    });

    test("sets cookie name as auth-token", async () => {
      const { createSession } = await import("@/lib/auth");

      await createSession("user-123", "test@example.com");

      const cookieCall = mockCookieStore.set.mock.calls[0];
      expect(cookieCall[0]).toBe("auth-token");
    });

    test("session payload expiresAt matches cookie expires", async () => {
      const { createSession } = await import("@/lib/auth");

      await createSession("user-123", "test@example.com");

      const jwtPayload = vi.mocked(SignJWT).mock.calls[0][0] as { expiresAt: Date };
      const cookieOptions = mockCookieStore.set.mock.calls[0][2] as { expires: Date };

      expect(jwtPayload.expiresAt.getTime()).toBe(cookieOptions.expires.getTime());
    });
  });

  describe("getSession", () => {
    test("returns null when no token cookie exists", async () => {
      mockCookieStore.get.mockReturnValue(undefined);
      const { getSession } = await import("@/lib/auth");

      const session = await getSession();

      expect(session).toBeNull();
      expect(mockCookieStore.get).toHaveBeenCalledWith("auth-token");
    });

    test("returns session payload when token is valid", async () => {
      const mockPayload = {
        userId: "user-123",
        email: "test@example.com",
        expiresAt: new Date(),
      };
      mockCookieStore.get.mockReturnValue({ value: "valid-token" });
      vi.mocked(jwtVerify).mockResolvedValue({ payload: mockPayload } as never);

      const { getSession } = await import("@/lib/auth");
      const session = await getSession();

      expect(session).toEqual(mockPayload);
      expect(jwtVerify).toHaveBeenCalled();
      const call = vi.mocked(jwtVerify).mock.calls[0];
      expect(call[0]).toBe("valid-token");
      expect(call[1].constructor.name).toBe("Uint8Array");
    });

    test("returns null when token verification fails", async () => {
      mockCookieStore.get.mockReturnValue({ value: "invalid-token" });
      vi.mocked(jwtVerify).mockRejectedValue(new Error("Invalid token"));

      const { getSession } = await import("@/lib/auth");
      const session = await getSession();

      expect(session).toBeNull();
    });

    test("returns null when token is expired", async () => {
      mockCookieStore.get.mockReturnValue({ value: "expired-token" });
      vi.mocked(jwtVerify).mockRejectedValue(new Error("Token expired"));

      const { getSession } = await import("@/lib/auth");
      const session = await getSession();

      expect(session).toBeNull();
    });
  });

  describe("deleteSession", () => {
    test("deletes the auth-token cookie", async () => {
      const { deleteSession } = await import("@/lib/auth");

      await deleteSession();

      expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
    });
  });

  describe("verifySession", () => {
    test("returns null when no token cookie in request", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue(undefined),
        },
      } as unknown as NextRequest;

      const { verifySession } = await import("@/lib/auth");
      const session = await verifySession(mockRequest);

      expect(session).toBeNull();
      expect(mockRequest.cookies.get).toHaveBeenCalledWith("auth-token");
    });

    test("returns session payload when token is valid", async () => {
      const mockPayload = {
        userId: "user-456",
        email: "user@example.com",
        expiresAt: new Date(),
      };
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: "valid-request-token" }),
        },
      } as unknown as NextRequest;
      vi.mocked(jwtVerify).mockResolvedValue({ payload: mockPayload } as never);

      const { verifySession } = await import("@/lib/auth");
      const session = await verifySession(mockRequest);

      expect(session).toEqual(mockPayload);
      expect(jwtVerify).toHaveBeenCalled();
      const call = vi.mocked(jwtVerify).mock.calls[0];
      expect(call[0]).toBe("valid-request-token");
      expect(call[1].constructor.name).toBe("Uint8Array");
    });

    test("returns null when token verification fails", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: "bad-token" }),
        },
      } as unknown as NextRequest;
      vi.mocked(jwtVerify).mockRejectedValue(new Error("Verification failed"));

      const { verifySession } = await import("@/lib/auth");
      const session = await verifySession(mockRequest);

      expect(session).toBeNull();
    });

    test("returns null when token is tampered", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: "tampered-token" }),
        },
      } as unknown as NextRequest;
      vi.mocked(jwtVerify).mockRejectedValue(
        new Error("signature verification failed")
      );

      const { verifySession } = await import("@/lib/auth");
      const session = await verifySession(mockRequest);

      expect(session).toBeNull();
    });
  });
});
