import { FastifyReply } from 'fastify';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<
    Pick<
      AuthService,
      | 'register'
      | 'confirmRegistration'
      | 'login'
      | 'confirmLogin'
      | 'refresh'
      | 'logout'
      | 'changePassword'
    >
  >;
  let cookieService: jest.Mocked<
    Pick<CookieService, 'setAuthCookies' | 'clearAuthCookies'>
  >;

  const tokens = { accessToken: 'a', refreshToken: 'r' };
  const user = { id: 'u1', email: 'u@example.com' };
  const reply = {} as FastifyReply;

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      confirmRegistration: jest.fn(),
      login: jest.fn(),
      confirmLogin: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      changePassword: jest.fn(),
    };
    cookieService = { setAuthCookies: jest.fn(), clearAuthCookies: jest.fn() };
    controller = new AuthController(
      authService as unknown as AuthService,
      cookieService as unknown as CookieService,
    );
  });

  it('register delegates to the service', async () => {
    authService.register.mockResolvedValue(user as never);
    await controller.register({
      email: 'u@example.com',
      password: 'password123',
    });
    expect(authService.register).toHaveBeenCalled();
  });

  it('login sets cookies when tokens are returned', async () => {
    authService.login.mockResolvedValue({ user, tokens } as never);
    const res = await controller.login(
      { email: 'u@example.com', password: 'x' },
      reply,
    );
    expect(cookieService.setAuthCookies).toHaveBeenCalledWith(reply, tokens);
    expect(res).toBe(user);
  });

  it('login returns the challenge (no cookies) when confirmation is required', async () => {
    authService.login.mockResolvedValue({
      requiresConfirmation: true,
      challengeId: 'c1',
    } as never);
    const res = await controller.login(
      { email: 'u@example.com', password: 'x' },
      reply,
    );
    expect(cookieService.setAuthCookies).not.toHaveBeenCalled();
    expect(res).toEqual({ requiresConfirmation: true, challengeId: 'c1' });
  });

  it('confirmLogin sets cookies', async () => {
    authService.confirmLogin.mockResolvedValue({ user, tokens } as never);
    await controller.confirmLogin({ challengeId: 'c1', code: '123456' }, reply);
    expect(cookieService.setAuthCookies).toHaveBeenCalledWith(reply, tokens);
  });

  it('confirmRegistration sets cookies', async () => {
    authService.confirmRegistration.mockResolvedValue({
      user,
      tokens,
    } as never);
    await controller.confirmRegistration(
      { challengeId: 'c1', code: '123456' },
      reply,
    );
    expect(cookieService.setAuthCookies).toHaveBeenCalledWith(reply, tokens);
  });

  it('refresh rotates and sets cookies', async () => {
    authService.refresh.mockResolvedValue(tokens as never);
    const res = await controller.refresh(
      { cookies: { refresh_token: 'r' } } as never,
      reply,
    );
    expect(cookieService.setAuthCookies).toHaveBeenCalledWith(reply, tokens);
    expect(res).toEqual({ success: true });
  });

  it('logout revokes the cookie tokens and clears cookies', async () => {
    const res = await controller.logout(
      { cookies: { access_token: 'a', refresh_token: 'r' } } as never,
      reply,
    );
    expect(authService.logout).toHaveBeenCalledWith('a', 'r');
    expect(cookieService.clearAuthCookies).toHaveBeenCalledWith(reply);
    expect(res).toEqual({ success: true });
  });

  it('changePassword re-issues cookies for the current session', async () => {
    authService.changePassword.mockResolvedValue(tokens);
    const res = await controller.changePassword(
      { currentPassword: 'old-password', newPassword: 'new-password1' },
      { userId: 'u1', email: 'u@example.com', roles: [] },
      reply,
    );
    expect(authService.changePassword).toHaveBeenCalledWith(
      'u1',
      expect.any(Object),
    );
    expect(cookieService.setAuthCookies).toHaveBeenCalledWith(reply, tokens);
    expect(res).toEqual({ success: true });
  });
});
