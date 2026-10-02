import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

/** Longest side of a stored product photo. Phones send 4000 px+; 1200 px is plenty for zoom. */
const MAX_SIDE = 1200;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'gif', 'tiff']);

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Turns any photo into a compact WebP: rotated upright from the camera's EXIF, shrunk to
   * 1200 px, metadata (including GPS location) stripped. A 5 MB phone photo ends up ~100 KB.
   */
  async saveImage(buffer: Buffer, createdById?: string) {
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException('That file is not a picture we can read. Use a JPG, PNG or WebP photo.');
    }
    if (!meta.format || !ACCEPTED.has(meta.format)) {
      throw new BadRequestException('Use a JPG, PNG or WebP photo.');
    }

    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const file = await this.prisma.mediaFile.create({
      data: { data, mime: 'image/webp', width: info.width, height: info.height, size: info.size, createdById },
      select: { id: true, width: true, height: true, size: true },
    });
    return { ...file, url: `/api/media/${file.id}.webp` };
  }

  async get(id: string) {
    return this.prisma.mediaFile.findUnique({ where: { id }, select: { data: true, mime: true } });
  }
}
