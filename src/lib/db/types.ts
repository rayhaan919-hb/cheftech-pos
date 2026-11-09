// Core domain types matching the Dexie v21 schema in app.js

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING';

export type KitchenStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';

export type DeliveryStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';

/** Mirrors the statuses the original app stamps onto the sale itself. */
export type SaleDeliveryStatus = DeliveryStatus | 'DELIVERED' | 'CANCELLED';

export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type SalaryStatus = 'PAID';

export type AdvanceStatus = 'PENDING' | 'SETTLED';

export type PaymentMethod = 'Cash' | 'Card' | 'Online';

export interface RefundRecord {
  timestamp: string;
  by: string;
  reason: string;
  amount: number;
  items: CartItem[];
}

export type OnlineOrderStatus =
  | 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'REJECTED';

// --- Main Models ---

export interface FloorTable {
  id?: number;
  number: string;
  status: TableStatus;
  waiter?: string;
  currentSale?: number;
  x?: number;
  y?: number;
}

export interface TableOrder {
  id?: number;
  tableId: number;
  status: OrderType;
  createdAt: string;
  items: CartItem[];
  total: number;
}

export interface HeldOrder {
  id?: number;
  timestamp: string;
  serverUser: string;
  orderType: OrderType;
  tableNumber?: string;
  kitchenStatus?: KitchenStatus;
  items: CartItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  deliveryCharge: number;
  packingCharge: number;
  taxPercent: number;
  taxAmount: number;
  otherCharge: number;
  loyaltyRedeemPoints?: number;
  loyaltyDiscount?: number;
  total: number;
  customer?: CustomerInfo;
  note?: string;
}

export interface CustomerInfo {
  name?: string;
  phone?: string;
  address?: string;
}

export interface CartItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  /** Written by partial refunds; never reduces `qty` so the original bill stays legible. */
  refundedQty?: number;
  modifiers?: ModifierSelection[];
  note?: string;
  customPrice?: number;
}

/** Shape persisted by the original app — keep it identical so existing carts still read. */
export interface ModifierSelection {
  group: string;
  name: string;
  price: number;
}

export interface PaymentDetail {
  method: PaymentMethod;
  amount: number;
  cashGiven?: number;
  change?: number;
}

export interface Sale {
  id?: number;
  localId?: number;
  timestamp: string;
  orderType: OrderType;
  tableNumber?: string;
  kitchenStatus?: KitchenStatus;
  serverUser: string;
  customer?: CustomerInfo;
  items: CartItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  deliveryCharge: number;
  packingCharge: number;
  taxPercent: number;
  taxAmount: number;
  otherCharge: number;
  loyaltyRedeemPoints?: number;
  loyaltyDiscount?: number;
  deliveryInfo?: CustomerInfo;
  deliveryStatus?: SaleDeliveryStatus;
  total: number;
  payments: PaymentDetail[];
  totalReceived: number;
  totalChange: number;
  refundedAmount?: number;
  refundStatus?: 'FULL' | 'PARTIAL';
  refunds?: RefundRecord[];
  /** Cloud row id once the sale has been pushed (append-only in the cloud). */
  cloudId?: string;
  onlineOrderId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Local inbox for website orders. `cloudId` is the cloud row id; the POS may only update those. */
export interface OnlineOrder {
  id?: number;
  cloudId?: string;
  idempotency_key?: string;
  createdAt: string;
  customer: CustomerInfo;
  orderType: OrderType;
  items: CartItem[];
  subtotal?: number;
  discountAmount?: number;
  couponCode?: string | null;
  loyaltyRedeemPoints?: number;
  loyaltyDiscount?: number;
  total: number;
  status: OnlineOrderStatus;
  note?: string;
  acceptedAt?: string;
  preparingAt?: string;
  dispatchedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;
  /** Cloud row id of the sale that fulfilled this order, once checked out. */
  saleId?: number;
  updatedAt?: string;
}

export interface Category {
  id: string;
  name: string;
  order?: number;
  updatedAt?: string;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  imageUrl?: string;
  description?: string;
  available?: boolean;
  isAddon?: boolean;
  modifierGroups?: ModifierGroup[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ModifierGroup {
  id: string;
  menuItemId?: string;
  name: string;
  required?: boolean;
  multiple?: boolean;
  options: ModifierOption[];
}

export interface ModifierOption {
  name: string;
  price: number;
}

export interface Recipe {
  id?: number;
  menuItemId: string;
  inventoryId: string;
  qtyRequired: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  stock: number;
  unit: string;
  cost: number;
  lowStockThreshold?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
  website?: string;
  imageUrl?: string;
  address?: string;
  notes?: string;
}

export interface StockHistory {
  id?: number;
  ingredient: string;
  created: string;
  action: string;
  qtyBefore: number;
  qtyAfter: number;
  reason?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  loyaltyPoints: number;
  totalOrders: number;
  totalSpent: number;
  lastVisit?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyReward {
  id?: number;
  name: string;
  description: string;
  pointsRequired: number;
  discountAmount?: number;
  discountPercent?: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoyaltySettings {
  earnRate: number;
  key?: string;
  value: string;
}

export interface Waiter {
  id: string;
  name: string;
  active: boolean;
}

export interface KitchenOrder {
  id?: number;
  saleId: number;
  tableId: number;
  status: KitchenStatus;
  createdAt: string;
  items: KitchenOrderItem[];
  note?: string;
}

export interface KitchenOrderItem {
  name: string;
  qty: number;
  note?: string;
}

export interface User {
  id?: number;
  username: string;
  passwordHash?: string;
  role: UserRole;
  active: boolean;
}

export interface Setting {
  key: string;
  value: any;
}

export interface Delivery {
  id?: number;
  saleId?: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  deliveryCharge: number;
  assignedTo?: string;
  eta?: string | null;
  status: DeliveryStatus;
  createdAt: string;
  acceptedAt?: string;
  pickedAt?: string;
  completedAt?: string;
  riderName?: string;
}

export interface Expense {
  id?: number;
  timestamp: string;
  amount: number;
  category: string;
  description: string;
  serverUser: string;
  status: ExpenseStatus;
  supplierId?: string;
  paymentMethod: string;
  receiptImage?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id?: number;
  timestamp: string;
  action: string;
  user: string;
  saleId?: number;
  details?: any;
}

export interface StaffMember {
  id?: number;
  name: string;
  phone: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  joinDate: string;
  monthlySalary: number;
  createdAt?: string;
}

export interface Attendance {
  id?: number;
  staffId: number;
  date: string;
  status: AttendanceStatus;
  markedBy?: string;
  timestamp?: string;
}

export interface Leave {
  id?: number;
  staffId: number;
  startDate: string;
  endDate: string;
  type: string;
  reason: string;
  status: LeaveStatus;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface SalaryPayment {
  id?: number;
  staffId: number;
  /** 1-based calendar month, matching the legacy records. */
  month: number;
  year: number;
  baseSalary: number;
  advancesDeducted: number;
  netPaid: number;
  status: SalaryStatus;
  paidAt: string;
  paidBy: string;
}

export interface AdvancePayment {
  id?: number;
  staffId: number;
  date: string;
  amount: number;
  note?: string;
  status: AdvanceStatus;
  createdAt?: string;
  settledInPayroll?: string;
}

export interface StockIn {
  id?: number;
  supplierId?: string;
  ingredient: string;
  created: string;
  qty: number;
  unitPrice: number;
  totalCost: number;
  date?: string;
}

export interface SupplierPayment {
  id?: number;
  supplierId: string;
  date: string;
  amount: number;
  method: string;
  reference?: string;
}

export interface SupplierLedger {
  id?: number;
  supplierId: string;
  date: string;
  referenceNumber: string;
  description: string;
  qtyIn?: number;
  unitPrice?: number;
  totalCost?: number;
  cashPaid?: number;
  runningBalance: number;
}
