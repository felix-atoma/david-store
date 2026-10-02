import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { SeoController } from './seo.controller';

@Module({
  imports: [CatalogModule],
  controllers: [SeoController],
})
export class SeoModule {}
