import { slugify } from '@david-store/shared';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Permission, Prisma, Role, SpecFieldType } from '@prisma/client';
import { AuthUser, CurrentUser, JwtAuthGuard, RequirePermission, Roles } from '../auth/jwt-auth.guard';
import { ActivityLogService } from '../common/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, CreateSpecFieldDto, UpdateCategoryDto, UpdateSpecFieldDto } from './admin-categories.dto';
import { CategoriesService } from './categories.service';

const OPTION_TYPES: SpecFieldType[] = [SpecFieldType.SELECT, SpecFieldType.MULTI_SELECT];

/** David manages the category tree and each category's filters himself. Hide a category rather than delete it. */
@Controller('admin/categories')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.STAFF)
@RequirePermission(Permission.PRODUCTS)
export class AdminCategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Every category, hidden ones included, flat; the dashboard builds the tree. */
  @Get()
  list() {
    return this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        specFields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  @Post()
  async create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    if (dto.parentId && !(await this.prisma.category.findUnique({ where: { id: dto.parentId }, select: { id: true } }))) {
      throw new BadRequestException('Parent category not found');
    }
    const slug = await this.uniqueSlug(dto.slug ?? slugify(dto.name));
    const category = await this.prisma.category.create({ data: { ...dto, slug } });
    await this.activity.record({ actorId: user.sub, action: 'category.create', entityType: 'Category', entityId: category.id, after: category });
    return category;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.category.findUniqueOrThrow({ where: { id } });
    if (dto.parentId) {
      // Moving a category under itself or one of its own sub-categories would make a loop.
      if ((await this.categories.descendantIds(id)).includes(dto.parentId)) {
        throw new BadRequestException('A category cannot be moved inside itself');
      }
    }
    if (dto.slug && dto.slug !== before.slug) dto.slug = await this.uniqueSlug(dto.slug, id);
    const after = await this.prisma.category.update({ where: { id }, data: dto });
    await this.activity.record({ actorId: user.sub, action: 'category.update', entityType: 'Category', entityId: id, before, after });
    return after;
  }

  /** Only empty categories can be deleted; anything with products or sub-categories gets hidden instead. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const category = await this.prisma.category.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (category._count.products || category._count.children) {
      throw new ConflictException('This category has products or sub-categories. Hide it instead.');
    }
    await this.prisma.category.delete({ where: { id } });
    await this.activity.record({ actorId: user.sub, action: 'category.delete', entityType: 'Category', entityId: id, before: category });
  }

  @Post(':id/spec-fields')
  async addField(@Param('id') id: string, @Body() dto: CreateSpecFieldDto, @CurrentUser() user: AuthUser) {
    this.checkOptions(dto.type, dto.options);
    try {
      const field = await this.prisma.categorySpecField.create({ data: { ...dto, options: dto.options ?? [], categoryId: id } });
      await this.activity.record({ actorId: user.sub, action: 'specField.create', entityType: 'Category', entityId: id, after: field });
      return field;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`This category already has a field with key "${dto.key}"`);
      }
      throw err;
    }
  }

  /** The key is fixed once created: products store their values under it. */
  @Patch('spec-fields/:fieldId')
  async updateField(@Param('fieldId') fieldId: string, @Body() dto: UpdateSpecFieldDto, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.categorySpecField.findUniqueOrThrow({ where: { id: fieldId } });
    if (dto.key && dto.key !== before.key) throw new BadRequestException('A field key cannot be changed; add a new field instead');
    this.checkOptions(dto.type ?? before.type, dto.options ?? before.options);
    const after = await this.prisma.categorySpecField.update({ where: { id: fieldId }, data: dto });
    await this.activity.record({ actorId: user.sub, action: 'specField.update', entityType: 'Category', entityId: before.categoryId, before, after });
    return after;
  }

  @Delete('spec-fields/:fieldId')
  @HttpCode(204)
  async removeField(@Param('fieldId') fieldId: string, @CurrentUser() user: AuthUser) {
    const field = await this.prisma.categorySpecField.delete({ where: { id: fieldId } });
    await this.activity.record({ actorId: user.sub, action: 'specField.delete', entityType: 'Category', entityId: field.categoryId, before: field });
  }

  private checkOptions(type: SpecFieldType, options?: string[]) {
    if (OPTION_TYPES.includes(type) && !options?.length) {
      throw new BadRequestException('Add at least one option for a choice field');
    }
  }

  private async uniqueSlug(base: string, exceptId?: string) {
    if (!base) throw new BadRequestException('Name must contain letters or numbers');
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const taken = await this.prisma.category.findUnique({ where: { slug }, select: { id: true } });
      if (!taken || taken.id === exceptId) return slug;
    }
  }
}
