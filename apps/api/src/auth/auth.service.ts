import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { AccessTokenPayload } from './jwt-auth.guard';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, meta: ClientMeta) {
    const email = dto.email?.toLowerCase().trim();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(dto.phone ? [{ phone: dto.phone }] : [])] },
    });
    if (existing) throw new ConflictException('An account with this email or phone already exists');

    const user = await this.prisma.user.create({
      data: { name: dto.name.trim(), email, phone: dto.phone, passwordHash: await bcrypt.hash(dto.password, 12) },
    });
    return this.issueSession(user, meta);
  }

  async login(dto: LoginDto, meta: ClientMeta) {
    const id = dto.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: id.includes('@') ? { email: id.toLowerCase() } : { phone: id },
    });
    const ok = user?.passwordHash && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('Wrong email, phone or password');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('This account has been blocked. Contact support.');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user, meta);
  }

  /**
   * Rotates the refresh token. Presenting a token that was already rotated means it leaked,
   * so every session for that user is revoked.
   */
  async refresh(token: string | undefined, meta: ClientMeta) {
    if (!token) throw new UnauthorizedException();
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!record) throw new UnauthorizedException();

    if (record.revokedAt) {
      if (record.replacedBy) {
        await this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (record.expiresAt < new Date() || record.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    const session = await this.issueSession(record.user, meta);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedBy: session.refreshTokenId },
    });
    return session;
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async profile(id: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, permissions: u.permissions };
  }

  private async issueSession(user: User, meta: ClientMeta) {
    const payload: AccessTokenPayload = { sub: user.id, ver: user.tokenVersion };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(this.config.get('REFRESH_TOKEN_DAYS') ?? 30);
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const stored = await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255) },
    });

    return { accessToken, refreshToken, refreshTokenId: stored.id, refreshExpiresAt: expiresAt, user: await this.profile(user.id) };
  }
}
