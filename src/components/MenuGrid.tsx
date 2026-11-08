import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import type { Category, MenuItem } from '../lib/db/types';

const ALL = 'ALL';

interface MenuGridProps {
  onPick: (item: MenuItem) => void;
}

export function MenuGrid({ onPick }: MenuGridProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL);

  const categories = useLive(() => db.categories.toArray(), []) ?? [];
  const menu = useLive(() => db.menu.toArray(), []) ?? [];

  const countByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of menu) counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
    return counts;
  }, [menu]);

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = query ? menu.filter((i) => (i.name || '').toLowerCase().includes(query)) : menu;
    const known = new Set(categories.map((c) => c.id));

    const groups = categories
      .filter((c) => query || selectedCategory === ALL || c.id === selectedCategory)
      .map((category) => ({ category, items: matches.filter((i) => i.categoryId === category.id) }))
      .filter((g) => g.items.length > 0);

    const orphans = matches.filter((i) => !i.categoryId || !known.has(i.categoryId));
    if (orphans.length) {
      groups.push({ category: { id: 'UNCATEGORIZED', name: 'Uncategorized' } as Category, items: orphans });
    }
    return groups;
  }, [categories, menu, search, selectedCategory]);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#616f75]" aria-hidden />
          <input
            id="posMenuSearchInput"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu items... (Press / to focus)"
            className="w-full pl-10 pr-4 h-10 text-sm text-[#000000] border border-[#b4c4cc] rounded-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-[#2941e0] focus:border-[#2941e0] transition-all"
          />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        <h3 className="font-display text-xs font-medium uppercase tracking-normal text-[#526066] mb-3">
          Menu Categories
        </h3>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label="Menu categories">
          <CategoryButton
            label="All Items"
            count={menu.length}
            active={selectedCategory === ALL}
            onClick={() => setSelectedCategory(ALL)}
          />
          {categories.map((cat) => (
            <CategoryButton
              key={cat.id}
              label={cat.name}
              count={countByCategory[cat.id] || 0}
              active={selectedCategory === cat.id}
              onClick={() => setSelectedCategory(cat.id)}
            />
          ))}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        {grouped.length === 0 ? (
          <p className="text-center text-[#616f75] py-6 text-sm">
            {search.trim()
              ? `No items match "${search.trim()}".`
              : 'No dishes available. Add some in Owner Admin.'}
          </p>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <section key={group.category.id}>
                <h4 className="font-display text-base font-medium text-[#273238] mb-2.5 flex items-center gap-2">
                  <span>{group.category.name}</span>
                  <span className="text-xs font-normal text-[#2941e0] bg-[#eff6ff] px-2.5 py-0.5 rounded-[88px]">
                    {group.items.length}
                  </span>
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.items.map((item) => {
                    const isUnavailable = item.available === false;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={isUnavailable}
                        onClick={() => !isUnavailable && onPick(item)}
                        title={isUnavailable ? `${item.name} is sold out` : `Add ${item.name} to the order`}
                        className={`menu-item-card w-full text-left rounded-2xl border border-[#e0edff] bg-white overflow-hidden transition-all focus-visible:ring-2 focus-visible:ring-[#2941e0] relative ${
                          isUnavailable ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {isUnavailable && (
                          <span className="absolute top-2 right-2 z-10 bg-red-600 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded-full">
                            Sold Out
                          </span>
                        )}
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            loading="lazy"
                            className="w-full h-24 object-cover border-b border-[#e0edff]"
                          />
                        ) : (
                          <div className="h-24 bg-[#eff6ff] flex items-center justify-center text-xs font-medium text-[#526066]">
                            Menu
                          </div>
                        )}
                        <div className="p-3">
                          <h3 className="font-sans font-medium text-sm text-[#000000] leading-snug line-clamp-2 min-h-10">
                            {item.name}
                          </h3>
                          <p className="text-[#2941e0] font-semibold text-sm mt-2">{formatAmount(item.price)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryButton({ label, count, active, onClick }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-4 h-9 rounded-[8px] text-sm whitespace-nowrap font-medium border transition-all duration-150 flex items-center gap-1.5 ${
        active
          ? 'bg-[#2941e0] text-white border-[#2941e0]'
          : 'bg-white text-[#273238] border-[#b4c4cc] hover:bg-[#eff6ff] hover:text-[#2941e0] hover:border-[#c5b9fa]'
      }`}
    >
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`text-xs px-2 py-0.5 rounded-[88px] font-mono ${
            active ? 'bg-white/20 text-white' : 'bg-[#eff6ff] text-[#2941e0]'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
