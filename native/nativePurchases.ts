import { registerPlugin } from '@capacitor/core';

export interface PurchaseOptions {
  productId: string;
}

export interface PurchaseResult {
  productId: string;
  purchaseToken: string;
  orderId?: string | null;
}

export interface NativePurchasesPlugin {
  buyNonConsumable(options: PurchaseOptions): Promise<PurchaseResult>;
  buyConsumable(options: PurchaseOptions): Promise<PurchaseResult>;
  buySubscription(options: PurchaseOptions): Promise<PurchaseResult>;
}

export const NativePurchases = registerPlugin<NativePurchasesPlugin>('NativePurchases');
