package com.subtit.player.plugins;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.AcknowledgePurchaseResponseListener;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.ConsumeResponseListener;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;

import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "NativePurchases")
public class NativePurchasesPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;
    private String pendingProductId;
    private boolean pendingConsumable;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        setupBillingClient();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (billingClient != null) {
            billingClient.endConnection();
        }
    }

    @PluginMethod
    public synchronized void buyNonConsumable(PluginCall call) {
        startPurchaseFlow(call, BillingClient.ProductType.INAPP, false);
    }

    @PluginMethod
    public synchronized void buyConsumable(PluginCall call) {
        startPurchaseFlow(call, BillingClient.ProductType.INAPP, true);
    }

    @PluginMethod
    public synchronized void buySubscription(PluginCall call) {
        startPurchaseFlow(call, BillingClient.ProductType.SUBS, false);
    }

    private void setupBillingClient() {
        if (billingClient != null) {
            return;
        }
        billingClient = BillingClient.newBuilder(getContext())
                .enablePendingPurchases()
                .setListener(this)
                .build();
    }

    private synchronized void startPurchaseFlow(final PluginCall call, final String productType, final boolean consumable) {
        String productId = call.getString("productId");
        if (productId == null || productId.trim().isEmpty()) {
            call.reject("productId is required");
            return;
        }
        if (pendingPurchaseCall != null) {
            call.reject("Another purchase is already in progress");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }
        call.setKeepAlive(true);
        pendingPurchaseCall = call;
        pendingProductId = productId;
        pendingConsumable = consumable;

        ensureConnection(call, () -> queryProductDetails(productId, productType));
    }

    private void ensureConnection(final PluginCall call, final Runnable onReady) {
        if (billingClient == null) {
            setupBillingClient();
        }
        if (billingClient == null) {
            finishWithError(call, "Billing client not available");
            return;
        }
        if (billingClient.isReady()) {
            runOnUiThread(onReady);
            return;
        }
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    runOnUiThread(onReady);
                } else {
                    finishWithError(call, "Billing setup failed: " + billingResult.getDebugMessage());
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Service will reconnect automatically on next request.
            }
        });
    }

    private void queryProductDetails(final String productId, final String productType) {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(productType)
                .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsList) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                finishPendingWithError("Query failed: " + billingResult.getDebugMessage());
                return;
            }
            if (productDetailsList == null || productDetailsList.isEmpty()) {
                finishPendingWithError("Product details not found for " + productId);
                return;
            }
            ProductDetails details = productDetailsList.get(0);
            launchBillingFlow(details, productType);
        });
    }

    private void launchBillingFlow(final ProductDetails productDetails, final String productType) {
        Activity activity = getActivity();
        if (activity == null) {
            finishPendingWithError("Activity not available");
            return;
        }
        BillingFlowParams.ProductDetailsParams.Builder paramsBuilder =
                BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails);

        if (BillingClient.ProductType.SUBS.equals(productType)) {
            List<ProductDetails.SubscriptionOfferDetails> offers = productDetails.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                finishPendingWithError("Subscription offer details missing for " + productDetails.getProductId());
                return;
            }
            String offerToken = offers.get(0).getOfferToken();
            if (TextUtils.isEmpty(offerToken)) {
                finishPendingWithError("Subscription offer token missing for " + productDetails.getProductId());
                return;
            }
            paramsBuilder.setOfferToken(offerToken);
        }

        BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(paramsBuilder.build()))
                .build();

        BillingResult result = billingClient.launchBillingFlow(activity, flowParams);
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            finishPendingWithError("Failed to launch purchase flow: " + result.getDebugMessage());
        }
    }

    @Override
    public synchronized void onPurchasesUpdated(@NonNull BillingResult billingResult, @Nullable List<Purchase> purchases) {
        if (pendingPurchaseCall == null) {
            return;
        }
        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) {
                if (purchase.getProducts().contains(pendingProductId)) {
                    handlePurchase(purchase);
                    return;
                }
            }
            finishPendingWithError("Purchase completed but product not found in response");
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            finishPendingWithError("Покупка отменена пользователем");
        } else {
            finishPendingWithError("Ошибка покупки: " + billingResult.getDebugMessage());
        }
    }

    private void handlePurchase(Purchase purchase) {
        if (pendingConsumable) {
            ConsumeParams params = ConsumeParams.newBuilder()
                    .setPurchaseToken(purchase.getPurchaseToken())
                    .build();
            billingClient.consumeAsync(params, new ConsumeResponseListener() {
                @Override
                public void onConsumeResponse(@NonNull BillingResult billingResult, @NonNull String outToken) {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        finishPendingSuccess(purchase);
                    } else {
                        finishPendingWithError("Consume failed: " + billingResult.getDebugMessage());
                    }
                }
            });
        } else if (!purchase.isAcknowledged()) {
            AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.getPurchaseToken())
                    .build();
            billingClient.acknowledgePurchase(params, new AcknowledgePurchaseResponseListener() {
                @Override
                public void onAcknowledgePurchaseResponse(@NonNull BillingResult billingResult) {
                    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        finishPendingSuccess(purchase);
                    } else {
                        finishPendingWithError("Acknowledge failed: " + billingResult.getDebugMessage());
                    }
                }
            });
        } else {
            finishPendingSuccess(purchase);
        }
    }

    private synchronized void finishPendingSuccess(Purchase purchase) {
        if (pendingPurchaseCall == null) {
            return;
        }
        PluginCall call = pendingPurchaseCall;
        String productId = pendingProductId;
        String token = purchase.getPurchaseToken();
        String orderId = purchase.getOrderId();
        clearPendingState();

        JSObject data = new JSObject();
        data.put("productId", productId);
        data.put("purchaseToken", token);
        data.put("orderId", orderId);

        runOnUiThread(() -> {
            call.setKeepAlive(false);
            call.resolve(data);
        });
    }

    private synchronized void finishPendingWithError(String message) {
        if (pendingPurchaseCall != null) {
            PluginCall call = pendingPurchaseCall;
            clearPendingState();
            runOnUiThread(() -> {
                call.setKeepAlive(false);
                call.reject(message);
            });
        }
    }

    private synchronized void finishWithError(PluginCall call, String message) {
        if (call == null) {
            return;
        }
        if (call == pendingPurchaseCall) {
            clearPendingState();
        }
        runOnUiThread(() -> {
            call.setKeepAlive(false);
            call.reject(message);
        });
    }

    private synchronized void clearPendingState() {
        pendingPurchaseCall = null;
        pendingProductId = null;
        pendingConsumable = false;
    }

    private void runOnUiThread(Runnable runnable) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(runnable);
        } else {
            mainHandler.post(runnable);
        }
    }
}
