export type UcpMessage = {
  type?: string;
  code?: string;
  content?: string;
  severity?: string;
  [k: string]: unknown;
};

export interface UcpOffer {
  variantId: string;
  productId: string;
  title: string;
  seller: string;
  sellerName?: string;
  sellerUrl?: string;
  price: number;
  currency: "USD";
  size: string;
  etaDate: string | null;
  etaText?: string;
  url?: string;
  checkoutUrl?: string;
}

export interface UcpAddress {
  firstName: string;
  lastName: string;
  streetAddress: string;
  extendedAddress?: string;
  locality: string;
  region: string;
  postalCode: string;
  country: "US";
  phoneNumber?: string;
}

export interface UcpCompleteResult {
  status: "ordered" | "handoff" | "failed";
  continueUrl?: string;
  orderId?: string;
  messages: UcpMessage[];
}

export interface UcpApi {
  searchOffers(i: {
    shoe_size: string;
    budget?: number | string | null;
    deadline?: string | null;
  }): Promise<UcpOffer[]>;
  createCart(i: {
    seller: string;
    variantId: string;
    quantity?: number;
  }): Promise<{ cartId: string; messages: UcpMessage[] }>;
  createCheckout(i: {
    seller: string;
    cartId: string;
  }): Promise<{ checkoutId: string; continueUrl?: string; messages: UcpMessage[] }>;
  setDestination(i: {
    seller: string;
    checkoutId: string;
    email: string;
    address: UcpAddress;
  }): Promise<{ continueUrl?: string; messages: UcpMessage[] }>;
  complete(i: { seller: string; checkoutId: string }): Promise<UcpCompleteResult>;
}

export type UcpRunner = (args: string[]) => Promise<unknown>;
