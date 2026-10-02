import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Permission, Role } from '@prisma/client';
import type { Response } from 'express';
import { AuthUser, CurrentUser, JwtAuthGuard, RequirePermission, Roles } from '../auth/jwt-auth.guard';
import { MediaService } from './media.service';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** One photo per request, field name "file". Staff with product rights and the owner only. */
  @Post('admin/media')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.SUPER_ADMIN, Role.STAFF)
  @RequirePermission(Permission.PRODUCTS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('Choose a photo to upload');
    return this.media.saveImage(file.buffer, user.sub);
  }

  /**
   * Public, and never changes for a given id, so browsers and Vercel's CDN keep it for a year
   * and the API is rarely asked twice for the same photo.
   */
  @Get('media/:file')
  @SkipThrottle()
  async serve(@Param('file') file: string, @Res() res: Response) {
    const id = file.replace(/\.webp$/, '');
    const media = /^[a-z0-9]{20,40}$/.test(id) ? await this.media.get(id) : null;
    if (!media) throw new NotFoundException();
    res.set({
      'Content-Type': media.mime,
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(Buffer.from(media.data));
  }
}
