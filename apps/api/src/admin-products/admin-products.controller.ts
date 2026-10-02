import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Permission, Role } from '@prisma/client';
import { AuthUser, CurrentUser, JwtAuthGuard, RequirePermission, Roles } from '../auth/jwt-auth.guard';
import { ProductListQuery, QuickEditDto, SaveProductDto } from './admin-products.dto';
import { AdminProductsService } from './admin-products.service';

/** Products are never deleted from here: archive hides them and keeps order history intact. */
@Controller('admin/products')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.STAFF)
@RequirePermission(Permission.PRODUCTS)
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  list(@Query() query: ProductListQuery) {
    return this.products.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  create(@Body() dto: SaveProductDto, @CurrentUser() user: AuthUser) {
    return this.products.create(dto, user.sub);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: SaveProductDto, @CurrentUser() user: AuthUser) {
    return this.products.update(id, dto, user.sub);
  }

  @Patch(':id')
  quickEdit(@Param('id') id: string, @Body() dto: QuickEditDto, @CurrentUser() user: AuthUser) {
    return this.products.quickEdit(id, dto, user.sub);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.products.duplicate(id, user.sub);
  }
}
