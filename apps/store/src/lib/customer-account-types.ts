export type CustomerAddress = {
  id: string;
  label: string;
  recipientName: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  isDefault: boolean;
};

export type CustomerOrderItem = {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  sku: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceInCents: number;
  totalInCents: number;
  slug: string;
  image: string;
};

export type CustomerOrder = {
  id: string;
  publicCode: string;
  status: string;
  paymentStatus: string;
  subtotalInCents: number;
  discountInCents: number;
  shippingInCents: number;
  totalInCents: number;
  placedAt: string;
  address: Record<string, unknown>;
  items: CustomerOrderItem[];
  payment: {
    provider: string;
    method: string;
    status: string;
    paidAt: string;
  } | null;
  shipment: {
    provider: string;
    service: string;
    status: string;
    trackingCode: string;
    dispatchedAt: string;
    deliveredAt: string;
    events: Array<{
      id: string;
      status: string;
      description: string;
      location: string;
      occurredAt: string;
    }>;
  } | null;
  history: Array<{
    id: string;
    status: string;
    reason: string;
    createdAt: string;
  }>;
};

export type CustomerFavorite = {
  productId: string;
  name: string;
  slug: string;
  image: string;
  priceInCents: number;
  stock: number;
  color: string;
  size: string;
  variantId: string;
  available: boolean;
};

export type CustomerReview = {
  id: string;
  orderItemId: string;
  productId: string;
  productName: string;
  rating: number;
  title: string;
  content: string;
  status: string;
  createdAt: string;
};

export type PendingReview = {
  orderItemId: string;
  productId: string;
  productName: string;
  deliveredAt: string;
};

export type CustomerReturn = {
  id: string;
  publicCode: string;
  orderId: string;
  orderCode: string;
  reason: string;
  description: string;
  resolution: string;
  status: string;
  requestedAt: string;
};

export type CustomerNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string;
  createdAt: string;
};

export type CustomerCoupon = {
  id: string;
  code: string;
  name: string;
  discountInCents: number;
  redeemedAt: string;
  orderCode: string;
};

export type CustomerAccountSnapshot = {
  authenticated: boolean;
  demo: boolean;
  panelDestination: string;
  profile: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    avatarUrl: string;
    cpfLastFour: string;
    birthDate: string;
    status: string;
    createdAt: string;
    lastSignInAt: string;
  };
  addresses: CustomerAddress[];
  orders: CustomerOrder[];
  favorites: CustomerFavorite[];
  reviews: CustomerReview[];
  pendingReviews: PendingReview[];
  returns: CustomerReturn[];
  notifications: CustomerNotification[];
  coupons: CustomerCoupon[];
  representative: {
    applicationStatus: string;
    applicationCode: string;
    applicationSubmittedAt: string;
    applicationUpdatedAt: string;
    representativeStatus: string;
    approved: boolean;
  };
  warning: string;
};

export const emptyCustomerAccount = (
  overrides: Partial<CustomerAccountSnapshot["profile"]> = {}
): CustomerAccountSnapshot => ({
  authenticated: false,
  demo: false,
  panelDestination: "",
  profile: {
    id: "",
    fullName: "",
    email: "",
    phone: "",
    avatarUrl: "",
    cpfLastFour: "",
    birthDate: "",
    status: "",
    createdAt: "",
    lastSignInAt: "",
    ...overrides
  },
  addresses: [],
  orders: [],
  favorites: [],
  reviews: [],
  pendingReviews: [],
  returns: [],
  notifications: [],
  coupons: [],
  representative: {
    applicationStatus: "",
    applicationCode: "",
    applicationSubmittedAt: "",
    applicationUpdatedAt: "",
    representativeStatus: "",
    approved: false
  },
  warning: ""
});
