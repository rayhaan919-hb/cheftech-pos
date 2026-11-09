import { useMemo, useRef, useState } from 'react';
import { Download, KeyRound, Pencil, Plus, Search, Trash2, Upload, X, Cloud, Image as ImageIcon } from 'lucide-react';
import { compressImageFile, formatBytes } from '../lib/imageCompressor';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount, currencySymbol } from '../lib/format';
import {
  deleteCategory,
  deleteMenuItem,
  saveCategory,
  saveMenuItem,
  toggleMenuItemAvailability,
  usedInSales,
} from '../lib/menu';
import type { RecipeDraft } from '../lib/menu';
import { collectBackup, importBackup } from '../lib/backup';
import { downloadJson } from '../lib/export';
import { Modal } from './Modal';
import { CloudSetupModal } from './CloudSetupModal';
import { StaffAccountsSection } from './StaffAccountsSection';
import { LoyaltyRewardsSection } from './LoyaltyRewardsSection';
import { changeUserPassword, readSession } from '../lib/auth';
import { setOwnerPin } from '../lib/ownerPin';
import type { Category, MenuItem, Recipe } from '../lib/db/types';

const INPUT = 'p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-w-0';
const PRIMARY = 'bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl';
const DANGER = 'bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1.5 rounded-lg';

interface Draft {
  name: string;
  price: string;
  categoryId: string;
  imageUrl: string;
  available: boolean;
}

const BLANK: Draft = { name: '', price: '', categoryId: '', imageUrl: '', available: true };

export function AdminSettingsModal({ username, notify, onClose }: {
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const categories = useLive(() => db.categories.toArray(), []) ?? [];
  const menu = useLive(() => db.menu.toArray(), []) ?? [];
  const recipes = useLive(() => db.recipes.toArray(), []) ?? [];

  const [newCategory, setNewCategory] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeDraft[]>([]);
  const [importReport, setImportReport] = useState<string[] | null>(null);
  const [showCloudSetup, setShowCloudSetup] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [compressionStats, setCompressionStats] = useState<string | null>(null);

  // H-01: Change Password & Owner PIN state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPin, setNewPin] = useState('');

  const fileInput = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return menu
      .filter((i) => !query || i.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [menu, search]);

  const recipesByItem = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const r of recipes) map.set(r.menuItemId, [...(map.get(r.menuItemId) || []), r]);
    return map;
  }, [recipes]);

  function resetForm() {
    setDraft(BLANK);
    setEditingId(null);
    setRecipeRows([]);
    setCompressionStats(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setCompressionStats(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
    setDraft({
      name: item.name,
      price: String(item.price ?? ''),
      categoryId: item.categoryId || categories[0]?.id || '',
      imageUrl: item.imageUrl || '',
      available: item.available !== false,
    });
    setRecipeRows((recipesByItem.get(item.id) || []).map((r) => ({ inventoryId: r.inventoryId, qtyRequired: String(r.qtyRequired) })));
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCompressing(true);
      const res = await compressImageFile(file, { maxWidth: 800, maxHeight: 800, quality: 0.82 });
      setDraft((d) => ({ ...d, imageUrl: res.dataUrl }));
      setCompressionStats(
        `${formatBytes(res.originalBytes)} → ${formatBytes(res.compressedBytes)} (-${res.compressionRatio}%)`
      );
      notify(`Image compressed to ${formatBytes(res.compressedBytes)}.`);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setCompressing(false);
    }
  }

  async function addCategory() {
    try {
      await saveCategory(newCategory, username);
      setNewCategory('');
      notify('Category added.');
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function removeCategory(category: Category) {
    const affected = menu.filter((i) => i.categoryId === category.id).length;
    const warning = affected ? ` ${affected} item(s) will move to Uncategorized.` : '';
    if (!window.confirm(`Delete category "${category.name}"?${warning}`)) return;
    await deleteCategory(category.id, username);
    if (draft.categoryId === category.id) setDraft((d) => ({ ...d, categoryId: '' }));
    notify(`Category "${category.name}" deleted.`);
  }

  async function submit() {
    try {
      await saveMenuItem(draft, recipeRows, username, editingId ?? undefined);
      notify(editingId ? `${draft.name.trim()} updated.` : `${draft.name.trim()} added to the menu.`);
      resetForm();
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const summary = await importBackup(await file.text(), username);
      const counts = Object.entries(summary.counts).map(([table, count]) => `${table}: ${count}`);
      const notes = summary.staff
        .filter((member) => !/password kept/.test(member.note))
        .map((member) => `${member.username} (${member.role}) — ${member.note}`);
      setImportReport([
        `Imported ${counts.join(', ') || 'nothing — the file had no rows'}.`,
        ...(summary.skipped.length ? [`Ignored unknown table(s): ${summary.skipped.join(', ')}.`] : []),
        ...(notes.length ? ['Staff accounts that need attention:', ...notes] : []),
      ]);
      notify(`Backup imported from ${file.name}.`);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(item: MenuItem) {
    const sales = await usedInSales(item.id);
    const warning = sales ? `\n\nIt appears in ${sales} recorded sale(s).` : '';
    if (!window.confirm(`Delete "${item.name}" and its recipe?${warning}`)) return;
    try {
      await deleteMenuItem(item.id, username, true);
      if (editingId === item.id) resetForm();
      notify(`${item.name} deleted.`);
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function handlePasswordChange() {
    try {
      await changeUserPassword(username, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      notify('Password updated successfully.');
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function handlePinUpdate() {
    try {
      await setOwnerPin(newPin, username);
      setNewPin('');
      notify('Owner PIN updated successfully.');
    } catch (err) {
      notify((err as Error).message);
    }
  }

  const isOwner = readSession()?.role === 'OWNER';

  return (
    <>
      <Modal title="Admin Settings" onClose={onClose} wide>
        <div className="space-y-4">
          <section className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2">
            <SectionTitle>Cloud Setup & Data</SectionTitle>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              Configure your Supabase project to enable multi-device sync and website orders.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowCloudSetup(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5"
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden /> Cloud Setup
              </button>
              <div className="h-8 w-px bg-indigo-200 mx-1" />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden /> Import backup
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => importFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={async () => {
                  downloadJson(`ChefTech_Modern_Backup_${new Date().toISOString().slice(0, 10)}.json`, await collectBackup());
                  notify('Full backup downloaded.');
                }}
                className="bg-white text-gray-700 text-xs font-bold px-3 py-2.5 rounded-xl ring-1 ring-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" aria-hidden /> Backup this app
              </button>
            </div>
            {importReport && (
              <ul className="bg-white rounded-xl border border-indigo-100 p-2.5 text-[11px] text-gray-700 space-y-1">
                {importReport.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Security: Password & Owner PIN</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                aria-label="Current password"
                className={INPUT}
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 chars)"
                aria-label="New password"
                className={INPUT}
              />
              <button
                type="button"
                onClick={handlePasswordChange}
                className={`${PRIMARY} flex items-center justify-center gap-1.5`}
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden /> Update Password
              </button>
            </div>
            {isOwner && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center pt-2 border-t border-gray-100">
                <input
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="New Owner PIN (4–8 digits)"
                  aria-label="New Owner PIN"
                  className={`${INPUT} sm:col-span-2`}
                />
                <button
                  type="button"
                  onClick={handlePinUpdate}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl"
                >
                  Update Owner PIN
                </button>
              </div>
            )}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Food categories</SectionTitle>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                placeholder="New category name"
                aria-label="New category name"
                className={`${INPUT} flex-1`}
              />
              <button type="button" onClick={addCategory} className={`${PRIMARY} flex items-center gap-1`}>
                <Plus className="w-3.5 h-3.5" aria-hidden /> Add
              </button>
            </div>
            {categories.length === 0 ? (
              <p className="text-[11px] text-gray-400 py-1">No categories yet — add one before creating dishes.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {categories.map((category) => (
                  <span key={category.id} className="inline-flex items-center gap-1 bg-purple-100 text-purple-900 px-2 py-1 rounded-full text-[11px] font-bold">
                    {category.name}
                    <button
                      type="button"
                      onClick={() => removeCategory(category)}
                      aria-label={`Delete category ${category.name}`}
                      className="text-red-600 hover:text-red-800"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <div className="flex items-center justify-between">
              <SectionTitle>{editingId ? `Editing "${draft.name}"` : 'Add a menu item'}</SectionTitle>
              {editingId && (
                <button type="button" onClick={resetForm} className="text-[10px] font-bold text-gray-500 hover:text-purple-700">
                  Cancel edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Dish name"
                aria-label="Dish name"
                className={INPUT}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                placeholder={`Price (${currencySymbol()})`}
                aria-label="Dish price"
                className={`${INPUT} font-bold text-purple-800`}
              />
              <select
                value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                aria-label="Dish category"
                className={INPUT}
              >
                <option value="">Select category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Dish Image Section with Local Auto-Compression & URL Support */}
            <div className="space-y-2 p-3 bg-white/70 rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-purple-600" />
                  Dish Photo
                </span>
                {compressing && (
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md animate-pulse">
                    Compressing...
                  </span>
                )}
                {compressionStats && !compressing && (
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                    {compressionStats}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-center">
                {/* Image Preview Thumbnail */}
                <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center group shadow-inner">
                  {draft.imageUrl ? (
                    <>
                      <img
                        src={draft.imageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((d) => ({ ...d, imageUrl: '' }));
                          setCompressionStats(null);
                          if (imageInputRef.current) imageInputRef.current.value = '';
                        }}
                        title="Remove photo"
                        className="absolute inset-0 bg-black/60 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4 text-red-300" />
                        <span className="text-[8px] font-bold mt-0.5">Remove</span>
                      </button>
                    </>
                  ) : (
                    <div className="text-center p-1">
                      <ImageIcon className="w-5 h-5 text-gray-300 mx-auto mb-0.5" />
                      <span className="text-[8px] text-gray-400 font-semibold block leading-tight">No Photo</span>
                    </div>
                  )}
                </div>

                {/* Upload Action & URL Fallback */}
                <div className="flex-1 w-full space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      id="dishImageFileInput"
                    />
                    <label
                      htmlFor="dishImageFileInput"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs rounded-xl border border-purple-200 cursor-pointer shadow-sm transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{draft.imageUrl ? 'Change Photo' : 'Upload Local Image'}</span>
                    </label>
                    <span className="text-[10px] text-gray-400 font-medium">Auto-compressed</span>
                  </div>

                  <input
                    type="url"
                    value={draft.imageUrl.startsWith('data:') ? '' : draft.imageUrl}
                    onChange={(e) => {
                      setDraft((d) => ({ ...d, imageUrl: e.target.value }));
                      setCompressionStats(null);
                    }}
                    placeholder={draft.imageUrl.startsWith('data:') ? 'Local image uploaded (or paste URL)' : 'Or paste web image URL...'}
                    aria-label="Dish image URL"
                    className={`${INPUT} w-full text-xs`}
                  />
                </div>

                {/* Available for ordering toggle */}
                <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700 px-2 py-1.5 shrink-0 cursor-pointer self-start sm:self-center">
                  <input
                    type="checkbox"
                    checked={draft.available}
                    onChange={(e) => setDraft((d) => ({ ...d, available: e.target.checked }))}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span>Available</span>
                </label>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">Ingredient deductions</span>
                <button
                  type="button"
                  onClick={() => setRecipeRows((rows) => [...rows, { inventoryId: '', qtyRequired: '' }])}
                  className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-100"
                >
                  + Add ingredient
                </button>
              </div>
              <RecipeRows rows={recipeRows} onChange={setRecipeRows} />
            </div>

            <div className="flex justify-end pt-1">
              <button type="button" onClick={submit} className={PRIMARY}>
                {editingId ? 'Save Changes' : 'Add to Menu'}
              </button>
            </div>
          </section>

          {isOwner && <StaffAccountsSection username={username} notify={notify} />}

          {isOwner && (
            <section className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-700">Loyalty Rewards</h3>
              <LoyaltyRewardsSection username={username} notify={notify} />
            </section>
          )}

          <section className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the menu..."
                aria-label="Search menu"
                className="w-full pl-10 pr-4 py-2.5 text-sm ring-1 ring-gray-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-gray-400 text-xs text-center py-6">
                {menu.length === 0 ? 'No dishes yet. Add the first one above.' : 'No dishes match that search.'}
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                {filtered.map((item) => {
                  const lines = recipesByItem.get(item.id) || [];
                  const isAvailable = item.available !== false;
                  return (
                    <li key={item.id} className="p-2.5 bg-white rounded-xl border border-gray-200 flex items-center gap-2">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-400 text-[9px] font-bold flex items-center justify-center shrink-0">
                          MENU
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-gray-800 truncate flex items-center gap-1.5">
                          <span>{item.name}</span>
                          {!isAvailable && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              Sold Out
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {formatAmount(item.price)}
                          {' · '}
                          {categoryName.get(item.categoryId) || 'Uncategorized'}
                          {' · '}
                          {lines.length} ingredient{lines.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0 items-center">
                        <button
                          type="button"
                          onClick={async () => {
                            await toggleMenuItemAvailability(item.id, !isAvailable, username);
                            notify(`${item.name} marked as ${!isAvailable ? 'Available' : 'Sold Out'}.`);
                          }}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                            isAvailable
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {isAvailable ? 'In Stock' : 'Sold Out'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          aria-label={`Edit ${item.name}`}
                          className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-1.5 rounded-lg"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          aria-label={`Delete ${item.name}`}
                          className={DANGER}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </Modal>
      {showCloudSetup && (
        <CloudSetupModal
          username={username}
          notify={notify}
          onClose={() => setShowCloudSetup(false)}
        />
      )}
    </>
  );
}

function RecipeRows({ rows, onChange }: {
  rows: RecipeDraft[];
  onChange: (rows: RecipeDraft[]) => void;
}) {
  const inventory = useLive(() => db.inventory.toArray(), []) ?? [];

  if (rows.length === 0) {
    return <p className="text-[10px] text-gray-400">No ingredients — this dish will not deduct stock when sold.</p>;
  }

  function update(index: number, patch: Partial<RecipeDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((row, index) => (
        <li key={index} className="flex gap-1.5">
          <select
            value={row.inventoryId}
            onChange={(e) => update(index, { inventoryId: e.target.value })}
            aria-label={`Ingredient ${index + 1}`}
            className={`${INPUT} flex-1`}
          >
            <option value="">Select ingredient...</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            value={row.qtyRequired}
            onChange={(e) => update(index, { qtyRequired: e.target.value })}
            placeholder="Qty"
            aria-label={`Ingredient ${index + 1} quantity`}
            className={`${INPUT} w-24`}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`Remove ingredient ${index + 1}`}
            className={DANGER}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">{children}</p>;
}
