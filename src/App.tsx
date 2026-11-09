import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ChefHat, CloudOff, LogOut, Menu, RefreshCw } from 'lucide-react';
import { db } from './lib/db';
import { useLive } from './lib/useLive';
import { initializeApp, readSession, revalidateSession, signOut } from './lib/auth';
import { getSyncStatus, startSync, stopSync, subscribeToSync, syncNow } from './lib/sync';
import { addToCart, calculateCartTotals, setQty } from './lib/cart';
import type { CartCharges } from './lib/cart';
import { getCustomer } from './lib/customers';
import { holdOrder } from './lib/held';
import { setOrderStatus } from './lib/onlineOrders';
import { formatAmount } from './lib/format';
import { getMinDeliveryOrder, recordSale, reopenSale, verifyStock } from './lib/sales';
import { printReceipt } from './lib/receipt';
import { getPrinterSettings, restorePrinterDevice } from './lib/printer';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { MenuGrid } from './components/MenuGrid';
import { CartPanel } from './components/CartPanel';
import { PaymentModal } from './components/PaymentModal';
import { ModifierModal } from './components/ModifierModal';
import { LiveStockPanel } from './components/LiveStockPanel';
import { OwnerPinModal } from './components/OwnerPinModal';
import { useOrderAlert } from './hooks/useOrderAlert';
import type { CartItem, CustomerInfo, MenuItem, OnlineOrder, PaymentDetail, Sale, User, UserRole } from './lib/db/types';

// Lazy-loaded modal dialogs for fast initial load and chunk splitting (<500kB)
const KitchenDisplayModal = lazy(() => import('./components/KitchenDisplayModal').then((m) => ({ default: m.KitchenDisplayModal })));
const HeldOrdersModal = lazy(() => import('./components/HeldOrdersModal').then((m) => ({ default: m.HeldOrdersModal })));
const DeliveriesModal = lazy(() => import('./components/DeliveriesModal').then((m) => ({ default: m.DeliveriesModal })));
const CustomersModal = lazy(() => import('./components/CustomersModal').then((m) => ({ default: m.CustomersModal })));
const SalesHistoryModal = lazy(() => import('./components/SalesHistoryModal').then((m) => ({ default: m.SalesHistoryModal })));
const InventoryModal = lazy(() => import('./components/InventoryModal').then((m) => ({ default: m.InventoryModal })));
const SuppliersModal = lazy(() => import('./components/SuppliersModal').then((m) => ({ default: m.SuppliersModal })));
const ExpensesModal = lazy(() => import('./components/ExpensesModal').then((m) => ({ default: m.ExpensesModal })));
const SalesAnalyticsModal = lazy(() => import('./components/SalesAnalyticsModal').then((m) => ({ default: m.SalesAnalyticsModal })));
const ProfitLossModal = lazy(() => import('./components/ProfitLossModal').then((m) => ({ default: m.ProfitLossModal })));
const StaffModal = lazy(() => import('./components/StaffModal').then((m) => ({ default: m.StaffModal })));
const OpeningCashModal = lazy(() => import('./components/OpeningCashModal').then((m) => ({ default: m.OpeningCashModal })));
const ShiftSummaryModal = lazy(() => import('./components/ShiftSummaryModal').then((m) => ({ default: m.ShiftSummaryModal })));
const ActivityLogModal = lazy(() => import('./components/ActivityLogModal').then((m) => ({ default: m.ActivityLogModal })));
const PrinterSettingsModal = lazy(() => import('./components/PrinterSettingsModal').then((m) => ({ default: m.PrinterSettingsModal })));
const AdminSettingsModal = lazy(() => import('./components/AdminSettingsModal').then((m) => ({ default: m.AdminSettingsModal })));
const OnlineOrdersModal = lazy(() => import('./components/OnlineOrdersModal').then((m) => ({ default: m.OnlineOrdersModal })));

type Session = { username: string; role: UserRole };

const EMPTY_CHARGES: CartCharges = {
  orderType: 'DINE_IN',
  tableNumber: undefined,
  discountPercent: 0,
  deliveryCharge: 0,
  packingCharge: 0,
  taxPercent: 0,
  otherCharge: 0,
  loyaltyPoints: 0,
};

function App() {
  const [session, setSession] = useState<Session | null>(readSession());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [charges, setCharges] = useState<CartCharges>(EMPTY_CHARGES);
  const [customer, setCustomer] = useState<CustomerInfo>({});
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [modifying, setModifying] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [pnlOpen, setPnlOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [openingCashOpen, setOpeningCashOpen] = useState(false);
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [onlineOrdersOpen, setOnlineOrdersOpen] = useState(false);
  const [kdsOpen, setKdsOpen] = useState(false);
  const [activeOnlineOrder, setActiveOnlineOrder] = useState<OnlineOrder | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pinGate, setPinGate] = useState<{ label: string; run: () => void } | null>(null);

  const totals = calculateCartTotals(cart, charges);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    initializeApp()
      .then(() => revalidateSession())
      .then((verified) => {
        if (!verified && session) {
          setSession(null);
        } else if (verified) {
          setSession({ username: verified.username, role: verified.role });
        }
      })
      .catch((err) => console.error('App init failed:', err));
    restorePrinterDevice().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // S-07: Periodic session integrity check + 10-minute inactivity auto-lock
  useEffect(() => {
    if (!session) return;

    const INACTIVITY_MS = 10 * 60 * 1000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        signOut();
        setSession(null);
        setCart([]);
        notify('Session locked due to 10 minutes of inactivity.');
      }, INACTIVITY_MS);
    };

    const verifyIntegrity = () => {
      void revalidateSession().then((verified) => {
        if (!verified) {
          setSession(null);
          setCart([]);
          notify('Session expired or invalidated. Please sign in again.');
        } else if (verified.role !== session.role || verified.username !== session.username) {
          setSession({ username: verified.username, role: verified.role });
        }
      });
    };

    resetIdleTimer();
    const integrityInterval = setInterval(verifyIntegrity, 30_000);
    const events = ['pointerdown', 'keydown', 'mousemove', 'touchstart'] as const;
    for (const ev of events) window.addEventListener(ev, resetIdleTimer, { passive: true });
    window.addEventListener('storage', verifyIntegrity);

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      clearInterval(integrityInterval);
      for (const ev of events) window.removeEventListener(ev, resetIdleTimer);
      window.removeEventListener('storage', verifyIntegrity);
    };
  }, [session, notify]);

  useEffect(() => {
    if (!session) return;
    startSync();
    return stopSync;
  }, [session]);

  useEffect(() => {
    let active = true;
    getCustomer(customer.phone).then((found) => {
      const onlinePts = Math.max(0, Number(activeOnlineOrder?.loyaltyRedeemPoints ?? activeOnlineOrder?.loyaltyDiscount) || 0);
      if (active) setLoyaltyBalance(Math.max(found?.loyaltyPoints || 0, onlinePts));
    });
    return () => {
      active = false;
    };
  }, [customer.phone, activeOnlineOrder]);

  const requireOwnerPin = useCallback(
    async (label: string, run: () => void) => {
      const verified = await revalidateSession();
      if (!verified) {
        setSession(null);
        notify('Session invalid. Please sign in again.');
        return;
      }
      if (verified.role !== 'OWNER') {
        notify('Only the Owner is authorized to access this section.');
        return;
      }
      setPinGate({ label, run });
    },
    [notify]
  );

  useOrderAlert(notify, onlineOrdersOpen);

  function pickItem(item: MenuItem) {
    if (item.modifierGroups?.length) {
      setModifying(item);
      return;
    }
    setCart((current) =>
      addToCart(current, { id: item.id, menuItemId: item.id, name: item.name, price: item.price, qty: 1 }),
    );
  }

  const resetOrder = useCallback(() => {
    setCart([]);
    setCharges(EMPTY_CHARGES);
    setCustomer({});
    setLoyaltyBalance(0);
    setActiveOnlineOrder(null);
  }, []);

  const hold = useCallback(async () => {
    if (!cart.length) return;
    const id = await holdOrder(cart, charges, customer.phone ? customer : undefined, session?.username || 'Staff');
    resetOrder();
    notify(`Held order #${id}${charges.tableNumber ? ` (${charges.tableNumber})` : ''}.`);
  }, [cart, charges, customer, notify, resetOrder, session?.username]);

  useEffect(() => {
    if (!session) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        document.getElementById('posMenuSearchInput')?.focus();
      } else if (e.key === 'F2' && cart.length > 0 && !paying) {
        e.preventDefault();
        if (session?.role === 'WAITER') {
          notify('Waiters cannot take payments. Ask a cashier or manager.');
          return;
        }
        setPaying(true);
      } else if (e.key === 'F4' && cart.length > 0 && !paying) {
        e.preventDefault();
        void hold();
      } else if (e.key === 'F8') {
        e.preventDefault();
        setKdsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, cart.length, paying, hold, notify]);

  async function closeOnlineOrder(saleId: number) {
    const order = activeOnlineOrder;
    if (!order?.id) return;
    const status = order.orderType === 'DELIVERY' ? 'PREPARING' : 'COMPLETED';
    await db.onlineOrders.update(order.id, { saleId });
    await setOrderStatus(order.id, status, session?.username || 'Staff');
  }

  async function complete(payments: PaymentDetail[]) {
    if (charges.orderType === 'DELIVERY' && !customer.phone?.trim()) {
      notify('Delivery orders need a customer phone number.');
      return;
    }
    if (charges.orderType === 'DELIVERY' && totals.subtotal - totals.discountAmount - totals.loyaltyDiscount < getMinDeliveryOrder()) {
      notify(`Minimum order total for delivery is ${formatAmount(getMinDeliveryOrder())}.`);
      return;
    }

    // P1: Skip duplicate stock verification for already-reserved online orders.
    // Retain normal stock verification for walk-in, dine-in, and standard POS orders.
    const isOnlineReservedOrder = Boolean(activeOnlineOrder);
    if (!isOnlineReservedOrder) {
      const stockError = await verifyStock(cart);
      if (stockError) {
        notify(stockError);
        return;
      }
    }

    const tableNumber = charges.orderType === 'DINE_IN' ? charges.tableNumber : undefined;

    try {
      const saleId = await recordSale({
        items: cart,
        orderType: charges.orderType,
        tableNumber,
        serverUser: session?.username || 'Staff',
        subtotal: totals.subtotal,
        discountPercent: charges.discountPercent,
        discountAmount: totals.discountAmount,
        deliveryCharge: totals.deliveryCharge,
        packingCharge: totals.packingCharge,
        taxPercent: charges.taxPercent,
        taxAmount: totals.taxAmount,
        otherCharge: totals.otherCharge,
        loyaltyRedeemPoints: charges.loyaltyPoints,
        loyaltyDiscount: totals.loyaltyDiscount,
        total: totals.grandTotal,
        payments,
        customer: customer.phone ? customer : undefined,
        deliveryInfo: charges.orderType === 'DELIVERY' ? customer : undefined,
        onlineOrderId: activeOnlineOrder ? (activeOnlineOrder.cloudId || String(activeOnlineOrder.id)) : null,
      });
      closeOnlineOrder(saleId);
      const sale: Sale = {
        id: saleId,
        timestamp: new Date().toISOString(),
        orderType: charges.orderType,
        tableNumber,
        serverUser: session?.username || 'Staff',
        items: cart,
        subtotal: totals.subtotal,
        discountPercent: charges.discountPercent,
        discountAmount: totals.discountAmount,
        deliveryCharge: totals.deliveryCharge,
        packingCharge: totals.packingCharge,
        taxPercent: charges.taxPercent,
        taxAmount: totals.taxAmount,
        otherCharge: totals.otherCharge,
        loyaltyRedeemPoints: charges.loyaltyPoints,
        loyaltyDiscount: totals.loyaltyDiscount,
        total: totals.grandTotal,
        payments,
        customer: customer.phone ? customer : undefined,
        deliveryInfo: charges.orderType === 'DELIVERY' ? customer : undefined,
        totalReceived: payments.reduce(
          (sum, p) => sum + (p.method === 'Cash' && p.cashGiven != null ? p.cashGiven : p.amount),
          0,
        ),
        totalChange: payments.reduce((sum, p) => sum + (Number(p.change) || 0), 0),
      };
      resetOrder();
      setPaying(false);
      notify(`Sale #${saleId} completed — ${formatAmount(totals.grandTotal)}`);
      getPrinterSettings().then((printer) => {
        if (!printer.autoPrint) return;
        setTimeout(() => {
          printReceipt(sale)
            .then((how) => {
              if (how === 'browser') notify('Printer unavailable — printing from the browser instead.');
            })
            .catch((e) => {
              console.error('Print receipt failed', e);
              notify('Printing failed. Sale was still recorded.');
            });
        }, 300);
      });
    } catch (err) {
      console.error('Sale failed:', err);
      notify('Failed to process sale. Please try again.');
    }
  }

  if (!session) {
    return <LoginScreen onSignedIn={(user: User) => setSession({ username: user.username, role: user.role })} />;
  }

  return (
    <div className="h-screen overflow-hidden bg-ui-bg flex flex-col">
      <header className="bg-white px-2.5 sm:px-6 h-14 flex justify-between items-center gap-1.5 sm:gap-3 sticky top-0 z-40 border-b border-[#d4d4d8] shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="lg:hidden w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-[8px] border border-[#b4c4cc] bg-white hover:bg-[#eff6ff] text-[#000000] flex items-center justify-center"
          >
            <Menu className="w-4 h-4" aria-hidden />
          </button>
          <h1 className="font-display text-sm sm:text-xl font-medium tracking-normal flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <img src="/logo.svg" alt="" className="w-6 h-6 sm:w-8 sm:h-8 shrink-0" />
            <span className="text-[#000000] truncate">ChefTech</span>
          </h1>
          <span className="hidden sm:inline-flex text-xs px-3 py-1 rounded-[88px] bg-[#eff6ff] font-medium text-[#2941e0] shrink-0">
            {session.role}
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setKdsOpen(true)}
            title="Open Kitchen Display System (F8)"
            className="bg-[#eff6ff] hover:bg-[#e0edff] text-[#2941e0] px-2.5 sm:px-3.5 h-8 sm:h-9 rounded-[8px] text-xs font-medium transition flex items-center gap-1 sm:gap-1.5 shrink-0"
          >
            <ChefHat className="w-4 h-4 shrink-0" aria-hidden /> <span>KDS</span>
          </button>
          <SyncBadge />
          <span className="hidden lg:inline text-xs text-[#526066]">
            Welcome, <strong className="font-medium text-[#000000]">{session.username}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              signOut();
              setSession(null);
              setCart([]);
            }}
            className="bg-white hover:bg-red-50 text-[#000000] hover:text-red-600 border border-[#b4c4cc] px-2.5 sm:px-4 h-8 sm:h-9 rounded-[8px] text-xs font-medium transition flex items-center gap-1 sm:gap-1.5 shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" /> <span>Logout</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar
          role={session.role}
          username={session.username}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          onSignOut={() => {
            signOut();
            setSession(null);
            setCart([]);
          }}
          onOpenKds={() => setKdsOpen(true)}
          onOpenHeldOrders={() => setHeldOpen(true)}
          onOpenDeliveries={() => setDeliveriesOpen(true)}
          onOpenCustomers={() => setCustomersOpen(true)}
          onOpenInventory={() => setInventoryOpen(true)}
          onOpenSuppliers={() => setSuppliersOpen(true)}
          onOpenExpenses={() => setExpensesOpen(true)}
          onOpenAnalytics={() => void requireOwnerPin('Authorize access to Sales Analytics', () => setAnalyticsOpen(true))}
          onOpenPnl={() => void requireOwnerPin('Authorize access to Profit & Loss Report', () => setPnlOpen(true))}
          onOpenStaff={() => void requireOwnerPin('Authorize access to Staff & Payroll Management', () => setStaffOpen(true))}
          onOpenOpeningCash={() => setOpeningCashOpen(true)}
          onOpenShiftSummary={() => setShiftSummaryOpen(true)}
          onOpenActivityLog={() => setActivityLogOpen(true)}
          onOpenPrinter={() => setPrinterOpen(true)}
          onOpenAdmin={() => void requireOwnerPin('Authorize access to Owner Admin Settings', () => setAdminOpen(true))}
          onOpenOnlineOrders={() => setOnlineOrdersOpen(true)}
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 pb-24 lg:pb-4 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 space-y-4">
            <MenuGrid onPick={pickItem} />

            <div id="posCartMobileAnchor" className="lg:hidden">
              <CartPanel
                items={cart}
                role={session.role}
                charges={charges}
                customer={customer}
                loyaltyBalance={loyaltyBalance}
                onChange={setCharges}
                onCustomerChange={setCustomer}
                notify={notify}
                onQtyChange={(id, qty) => setCart((c) => setQty(c, id, qty))}
                onRemove={(id) => setCart((c) => c.filter((i) => i.id !== id))}
                onHold={hold}
                onCheckout={() => setPaying(true)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <LiveStockPanel
                canManage={session.role === 'OWNER' || session.role === 'MANAGER'}
                username={session.username}
                onManage={() => setInventoryOpen(true)}
              />

              <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-sm font-medium text-[#273238]">Recent Sales</h3>
                  <button
                    type="button"
                    onClick={() => setSalesOpen(true)}
                    className="text-xs font-medium text-[#2941e0] hover:underline px-2 py-1"
                  >
                    Manage
                  </button>
                </div>
                <RecentSales />
              </div>
            </div>
          </div>

          <aside className="hidden lg:block lg:sticky lg:top-0">
            <CartPanel
              items={cart}
              role={session.role}
              charges={charges}
              customer={customer}
              loyaltyBalance={loyaltyBalance}
              onChange={setCharges}
              onCustomerChange={setCustomer}
              notify={notify}
              onQtyChange={(id, qty) => setCart((c) => setQty(c, id, qty))}
              onRemove={(id) => setCart((c) => c.filter((i) => i.id !== id))}
              onHold={hold}
              onCheckout={() => setPaying(true)}
            />
          </aside>
        </main>
      </div>

      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[#000524] border-t border-[#795afa]/40 px-4 py-2.5 flex items-center justify-between gap-3 shadow-2xl">
          <button
            type="button"
            onClick={() => document.getElementById('posCartMobileAnchor')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-left min-w-0"
          >
            <div className="text-[11px] font-medium text-[#c5b9fa]">
              {cart.reduce((s, i) => s + i.qty, 0)} items · {charges.orderType.replace('_', ' ')}
              {charges.tableNumber ? ` (${charges.tableNumber})` : ''}
            </div>
            <div className="font-display text-base font-semibold text-white tabular-nums">
              {formatAmount(totals.grandTotal)}
            </div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => document.getElementById('posCartMobileAnchor')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-3 h-9 rounded-[8px] border border-[#c5b9fa]/50 text-xs font-medium text-white hover:bg-white/10"
            >
              View Order
            </button>
            <button
              type="button"
              onClick={() => {
                if (session.role === 'WAITER') {
                  notify('Waiters cannot take payments. Ask a cashier or manager.');
                  return;
                }
                setPaying(true);
              }}
              className="px-4 h-9 rounded-[8px] bg-[#2941e0] hover:bg-[#1f35c4] text-xs font-medium text-white"
            >
              Checkout
            </button>
          </div>
        </div>
      )}

      {paying && (
        <PaymentModal
          total={totals.grandTotal}
          onCancel={() => setPaying(false)}
          onConfirm={complete}
        />
      )}

      <Suspense fallback={null}>
        {kdsOpen && <KitchenDisplayModal onClose={() => setKdsOpen(false)} notify={notify} />}

        {heldOpen && (
          <HeldOrdersModal
            onClose={() => setHeldOpen(false)}
            onRestore={({ items, charges: restored, customer: restoredCustomer }) => {
              setCart(items);
              setCharges(restored);
              setCustomer(restoredCustomer ?? {});
              setLoyaltyBalance(0);
              setHeldOpen(false);
              notify('Held order restored to cart.');
            }}
          />
        )}

        {deliveriesOpen && (
          <DeliveriesModal onClose={() => setDeliveriesOpen(false)} notify={notify} />
        )}

        {customersOpen && <CustomersModal onClose={() => setCustomersOpen(false)} />}

        {inventoryOpen && <InventoryModal onClose={() => setInventoryOpen(false)} notify={notify} />}

        {suppliersOpen && <SuppliersModal onClose={() => setSuppliersOpen(false)} notify={notify} />}

        {expensesOpen && (
          <ExpensesModal
            role={session.role}
            username={session.username}
            onClose={() => setExpensesOpen(false)}
            notify={notify}
          />
        )}

        {staffOpen && (
          <StaffModal username={session.username} onClose={() => setStaffOpen(false)} notify={notify} />
        )}

        {openingCashOpen && (
          <OpeningCashModal
            username={session.username}
            onClose={() => setOpeningCashOpen(false)}
            notify={notify}
          />
        )}

        {shiftSummaryOpen && (
          <ShiftSummaryModal
            username={session.username}
            onClose={() => setShiftSummaryOpen(false)}
            notify={notify}
            onClosed={() => setOpeningCashOpen(true)}
          />
        )}

        {onlineOrdersOpen && (
          <OnlineOrdersModal
            username={session.username}
            notify={notify}
            onClose={() => setOnlineOrdersOpen(false)}
            onAccept={(items, order) => {
              const itemsSub = items.reduce((sum, i) => sum + Number(i.price) * Number(i.qty), 0);
              const loyaltyPts = Math.max(0, Number(order.loyaltyRedeemPoints ?? order.loyaltyDiscount) || 0);
              const explicitCouponDisc = Math.max(0, Number(order.discountAmount) || 0);
              const inferredDisc =
                explicitCouponDisc === 0 && loyaltyPts === 0 && Number(order.total) > 0 && Number(order.total) < itemsSub
                  ? itemsSub - Number(order.total)
                  : explicitCouponDisc;
              const discPct = itemsSub > 0 && inferredDisc > 0 ? Math.round((inferredDisc / itemsSub) * 100) : 0;
              setCart(items);
              setCharges({
                ...EMPTY_CHARGES,
                orderType: order.orderType,
                discountPercent: discPct,
                discountAmountOverride: inferredDisc > 0 ? inferredDisc : undefined,
                loyaltyPoints: loyaltyPts,
              });
              setCustomer(order.customer || {});
              setLoyaltyBalance(loyaltyPts);
              setActiveOnlineOrder(order);
            }}
          />
        )}

        {activityLogOpen && <ActivityLogModal onClose={() => setActivityLogOpen(false)} />}

        {printerOpen && (
          <PrinterSettingsModal
            username={session.username}
            notify={notify}
            preview={
              totals.grandTotal > 0
                ? {
                    title: `${charges.orderType.replace('_', ' ')} · ${charges.tableNumber ? `Table ${charges.tableNumber}` : 'Walk-in'}`,
                    lines: cart.map((line): [string, string] => [
                      `${line.qty} × ${line.name}`,
                      formatAmount(line.price * line.qty),
                    ]),
                    total: totals.grandTotal,
                  }
                : null
            }
            onClose={() => setPrinterOpen(false)}
          />
        )}

        {adminOpen && (
          <AdminSettingsModal
            username={session.username}
            notify={notify}
            onClose={() => setAdminOpen(false)}
          />
        )}

        {analyticsOpen && <SalesAnalyticsModal onClose={() => setAnalyticsOpen(false)} />}

        {pnlOpen && <ProfitLossModal onClose={() => setPnlOpen(false)} />}

        {salesOpen && (
          <SalesHistoryModal
            role={session.role}
            username={session.username}
            notify={notify}
            onClose={() => setSalesOpen(false)}
            onReopen={async (sale: Sale) => {
              if (cart.length && !window.confirm('Your cart is not empty. Re-open this order and overwrite it?')) return;
              await reopenSale(sale, session.username);
              setCart(sale.items);
              setCharges({
                orderType: sale.orderType || 'DINE_IN',
                tableNumber: sale.tableNumber,
                discountPercent: Number(sale.discountPercent) || 0,
                deliveryCharge: Number(sale.deliveryCharge) || 0,
                packingCharge: Number(sale.packingCharge) || 0,
                taxPercent: Number(sale.taxPercent) || 0,
                otherCharge: Number(sale.otherCharge) || 0,
                loyaltyPoints: Number(sale.loyaltyRedeemPoints) || 0,
              });
              setCustomer(sale.customer || sale.deliveryInfo || {});
              setSalesOpen(false);
              notify(`Order #${sale.id} loaded back into the cart.`);
            }}
          />
        )}
      </Suspense>

      {modifying && (
        <ModifierModal
          item={modifying}
          notify={notify}
          onCancel={() => setModifying(null)}
          onAdd={(cartItem) => {
            setCart((current) => addToCart(current, cartItem));
            setModifying(null);
          }}
        />
      )}

      {pinGate && (
        <OwnerPinModal
          action={pinGate.label}
          onClose={() => setPinGate(null)}
          onAuthorized={() => {
            const actionToRun = pinGate.run;
            setPinGate(null);
            actionToRun();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[100] bg-[#000524] border border-[#795afa] text-white text-sm font-medium px-4 py-3 rounded-[10px] shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function SyncBadge() {
  const status = useSyncExternalStore(subscribeToSync, getSyncStatus, getSyncStatus);

  if (status.state === 'off') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-[#616f75] shrink-0" title="Sign in with a cloud account to sync across devices">
        <CloudOff className="w-3.5 h-3.5 shrink-0" /> <span className="hidden sm:inline">Local only</span>
      </span>
    );
  }
  const error = status.state === 'error';
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={error ? `Sync error: ${status.error}` : status.lastSync ? `Last synced ${new Date(status.lastSync).toLocaleTimeString()}` : 'Syncing'}
      className={`flex items-center gap-1 text-[10px] font-bold px-2 sm:px-3 h-8 sm:h-9 rounded-lg border shrink-0 ${
        error ? 'text-red-600 bg-red-50 border-red-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'
      }`}
    >
      <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${status.state === 'syncing' ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{error ? 'Sync issue' : status.state === 'syncing' ? 'Syncing' : 'Synced'}</span>
    </button>
  );
}

function RecentSales() {
  const sales = useLive(() => db.sales.orderBy('timestamp').reverse().limit(8).toArray(), []);

  if (!sales?.length) return <p className="text-xs text-gray-400 py-4 text-center">No sales yet.</p>;

  return (
    <ul className="space-y-2 text-xs max-h-[420px] overflow-y-auto custom-scrollbar">
      {sales.map((sale) => (
        <li key={sale.id} className="flex justify-between items-center gap-2 p-2 rounded-lg bg-gray-50">
          <span className="text-gray-500 tabular-nums">
            #{sale.id} · {new Date(sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {sale.tableNumber ? ` · ${sale.tableNumber}` : ''}
          </span>
          <span className="font-bold text-gray-800">{formatAmount(sale.total)}</span>
        </li>
      ))}
    </ul>
  );
}

export default App;
