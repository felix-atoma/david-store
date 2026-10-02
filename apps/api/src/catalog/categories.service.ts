import { Injectable, NotFoundException } from '@nestjs/common';
import { CategorySpecField } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface MenuNode {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  isFeatured: boolean;
  children: MenuNode[];
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active categories as a nested tree, for the mega menu and homepage tiles. */
  async tree(): Promise<MenuNode[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, iconUrl: true, isFeatured: true, parentId: true },
    });
    const nodes = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, slug: r.slug, iconUrl: r.iconUrl, isFeatured: r.isFeatured, children: [] as MenuNode[] }]));
    const roots: MenuNode[] = [];
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      if (!r.parentId) roots.push(node);
      // A child of a hidden parent is hidden too, so it simply isn't attached.
      else nodes.get(r.parentId)?.children.push(node);
    }
    return roots;
  }

  /** The category and everything below it, at any depth. */
  async descendantIds(id: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Category" WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM "Category" c JOIN sub ON c."parentId" = sub.id
      )
      SELECT id FROM sub`;
    return rows.map((r) => r.id);
  }

  /** Root first, the category itself last: the breadcrumb. */
  async ancestors(id: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; slug: string; depth: number }[]>`
      WITH RECURSIVE up AS (
        SELECT id, name, slug, "parentId", 0 AS depth FROM "Category" WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.name, c.slug, c."parentId", up.depth + 1 FROM "Category" c JOIN up ON c.id = up."parentId"
      )
      SELECT id, name, slug, depth FROM up ORDER BY depth DESC`;
    return rows.map(({ id: ancestorId, name, slug }) => ({ id: ancestorId, name, slug }));
  }

  /**
   * Spec fields that apply to a category: its own plus every ancestor's, parents first.
   * A field redefined lower down (same key) replaces the inherited one.
   */
  async effectiveSpecFields(id: string, filterableOnly = false) {
    const chain = await this.ancestors(id);
    const fields = await this.prisma.categorySpecField.findMany({
      where: { categoryId: { in: chain.map((c) => c.id) }, ...(filterableOnly ? { filterable: true } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
    const depth = new Map(chain.map((c, i) => [c.id, i]));
    const byKey = new Map<string, CategorySpecField>();
    for (const f of [...fields].sort((a, b) => depth.get(a.categoryId)! - depth.get(b.categoryId)! || a.sortOrder - b.sortOrder)) {
      byKey.set(f.key, f);
    }
    return [...byKey.values()];
  }

  async findActiveBySlug(slug: string) {
    const category = await this.prisma.category.findFirst({ where: { slug, isActive: true } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }
}
