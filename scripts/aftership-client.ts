/**
 * AfterShip Tracking API Client
 *
 * Direct client using the official @aftership/tracking-sdk.
 * Reads configuration from config.json (symlinked to tmpfs).
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
import { AfterShip } from "@aftership/tracking-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config interface
interface AfterShipConfig {
  aftership: {
    apiKey: string;
  };
}

// Carrier-aware delay thresholds (in days)
const DELAY_THRESHOLDS: Record<string, number> = {
  ups: 1,
  "royal-mail": 3,
  royalmail: 3,
  carrier-freight: 2,
  default: 2,
};

// Initialize cache with namespace
const cache = new PluginCache({
  namespace: "aftership-tracking-manager",
  defaultTTL: TTL.FIVE_MINUTES,
});

export class AfterShipClient {
  private sdk: AfterShip;
  private cacheDisabled: boolean = false;

  constructor() {
    // When compiled, __dirname is dist/, so look in parent for config.json
    const configPath = join(__dirname, "..", "config.json");
    const configFile: AfterShipConfig = JSON.parse(
      readFileSync(configPath, "utf-8")
    );

    if (!configFile.aftership?.apiKey) {
      throw new Error(
        "Missing required config in config.json: aftership.apiKey"
      );
    }

    // SDK uses snake_case for options
    this.sdk = new AfterShip({ api_key: configFile.aftership.apiKey });
  }

  // Cache control methods
  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  getCacheStats() {
    return cache.getStats();
  }

  clearCache(): number {
    return cache.clear();
  }

  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  invalidateByOrderId(orderId: string): number {
    const pattern = new RegExp(
      `order.*${orderId}|tracking.*order_id.*${orderId}`,
      "i"
    );
    return cache.invalidatePattern(pattern);
  }

  // ============================================
  // TRACKING OPERATIONS
  // ============================================

  /**
   * Lists shipment trackings with optional filtering.
   *
   * @param options - Filter options
   * @param options.tag - Filter by tag: "Pending", "InTransit", "Delivered", "Exception", etc.
   * @param options.slug - Filter by carrier slug (e.g., "ups", "royal-mail")
   * @param options.order_id - Filter by order ID
   * @param options.created_at_min - Filter by creation date (ISO 8601)
   * @param options.created_at_max - Filter by creation date (ISO 8601)
   * @param options.limit - Maximum results (default: 100)
   * @returns Object with trackings array and count
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * // Get all in-transit shipments
   * const { trackings } = await client.listTrackings({ tag: "InTransit" });
   *
   * // Get UPS shipments from last week
   * const { trackings } = await client.listTrackings({
   *   slug: "ups",
   *   created_at_min: "2024-01-01T00:00:00Z"
   * });
   */
  async listTrackings(options?: {
    tag?: string;
    slug?: string;
    order_id?: string;
    created_at_min?: string;
    created_at_max?: string;
    limit?: number;
  }): Promise<{ trackings: any[]; count: number }> {
    const cacheKey = createCacheKey("trackings", {
      tag: options?.tag,
      slug: options?.slug,
      order_id: options?.order_id,
      created_at_min: options?.created_at_min,
      created_at_max: options?.created_at_max,
      limit: options?.limit,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const response = await this.sdk.tracking.getTrackings({
          tag: options?.tag,
          slug: options?.slug,
          order_id: options?.order_id,
          created_at_min: options?.created_at_min,
          created_at_max: options?.created_at_max,
          limit: options?.limit || 100,
        });

        return {
          trackings: response.trackings || [],
          count: response.trackings?.length || 0,
        };
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Retrieves a tracking by its AfterShip ID.
   *
   * @param id - The AfterShip tracking ID
   * @returns The tracking object with full details
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * const tracking = await client.getTrackingById("abc123xyz");
   */
  async getTrackingById(id: string): Promise<any> {
    const cacheKey = createCacheKey("tracking:id", { id });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // SDK returns the tracking data directly
        const response = await this.sdk.tracking.getTrackingById(id);
        return response;
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Retrieves a tracking by tracking number and carrier.
   *
   * @param trackingNumber - The carrier tracking number
   * @param slug - Carrier slug (e.g., "ups", "royal-mail", "carrier-freight")
   * @returns The tracking object
   * @throws {Error} If tracking not found
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * const tracking = await client.getTrackingByNumber("1Z999AA10123456784", "ups");
   */
  async getTrackingByNumber(
    trackingNumber: string,
    slug: string
  ): Promise<any> {
    const cacheKey = createCacheKey("tracking:number", {
      number: trackingNumber,
      slug,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // Use getTrackings with filters since there's no direct method
        const response = await this.sdk.tracking.getTrackings({
          tracking_numbers: trackingNumber,
          slug: slug,
          limit: 1,
        });

        if (response.trackings && response.trackings.length > 0) {
          return response.trackings[0];
        }
        throw new Error(`Tracking not found: ${trackingNumber} / ${slug}`);
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Searches for trackings by Shopify order ID.
   *
   * Searches both exact order_id match and keyword search as fallback.
   *
   * @param orderId - The Shopify order ID (e.g., "5678901234567")
   * @returns Array of matching trackings
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * const trackings = await client.searchByOrderId("5678901234567");
   */
  async searchByOrderId(orderId: string): Promise<any[]> {
    const cacheKey = createCacheKey("order", { orderId });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // Use order_id parameter for direct search
        const response = await this.sdk.tracking.getTrackings({
          order_id: orderId,
          limit: 100,
        });

        const trackings = response.trackings || [];

        // Also try keyword search as fallback for partial matches
        if (trackings.length === 0) {
          const keywordResponse = await this.sdk.tracking.getTrackings({
            keyword: orderId,
            limit: 100,
          });
          return keywordResponse.trackings || [];
        }

        return trackings;
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Creates a new shipment tracking.
   *
   * @param data - Tracking creation data
   * @param data.tracking_number - Carrier tracking number (required)
   * @param data.slug - Carrier slug (auto-detected if not provided)
   * @param data.order_id - Associated Shopify order ID
   * @param data.title - Display title for the tracking
   * @param data.custom_fields - Custom metadata fields (key-value pairs)
   * @returns The created tracking object
   *
   * @invalidates tracking/*, order/*
   *
   * @example
   * const tracking = await client.createTracking({
   *   tracking_number: "1Z999AA10123456784",
   *   slug: "ups",
   *   order_id: "5678901234567",
   *   title: "Order #1234"
   * });
   *
   * @example
   * // With custom fields for inbound tracking
   * const tracking = await client.createTracking({
   *   tracking_number: "1Z999AA10123456784",
   *   slug: "ups",
   *   title: "Inbound from Supplier",
   *   custom_fields: {
   *     direction: "inbound",
   *     source: "gmail-auto",
   *     vendor: "Acme Corp"
   *   }
   * });
   */
  async createTracking(data: {
    tracking_number: string;
    slug?: string;
    order_id?: string;
    title?: string;
    custom_fields?: Record<string, string>;
  }): Promise<any> {
    const trackingData: any = {
      tracking_number: data.tracking_number,
      slug: data.slug,
      order_id: data.order_id,
      title: data.title,
    };

    // Add custom_fields if provided
    if (data.custom_fields && Object.keys(data.custom_fields).length > 0) {
      trackingData.custom_fields = data.custom_fields;
    }

    const response = await this.sdk.tracking.createTracking(trackingData);

    // Invalidate caches after mutation
    cache.invalidatePattern(/^tracking/);
    cache.invalidatePattern(/^order/);

    return response;
  }

  /**
   * Updates an existing tracking.
   *
   * @param id - AfterShip tracking ID
   * @param data - Fields to update
   * @param data.title - New display title
   * @param data.order_id - New associated order ID
   * @returns The updated tracking object
   *
   * @invalidates tracking:id/{id}, order/*
   */
  async updateTracking(
    id: string,
    data: { title?: string; order_id?: string }
  ): Promise<any> {
    const response = await this.sdk.tracking.updateTrackingById(id, {
      title: data.title,
      order_id: data.order_id,
    });

    // Invalidate caches
    cache.invalidate(createCacheKey("tracking:id", { id }));
    cache.invalidatePattern(/^order/);

    return response;
  }

  /**
   * Deletes a tracking from AfterShip.
   *
   * @param id - AfterShip tracking ID to delete
   *
   * @invalidates tracking:id/{id}, tracking/*, order/*
   */
  async deleteTracking(id: string): Promise<void> {
    await this.sdk.tracking.deleteTrackingById(id);

    // Invalidate caches
    cache.invalidate(createCacheKey("tracking:id", { id }));
    cache.invalidatePattern(/^tracking/);
    cache.invalidatePattern(/^order/);
  }

  /**
   * Re-tracks a shipment that stopped tracking.
   *
   * Use this when a tracking shows stale data or carrier stopped updating.
   *
   * @param id - AfterShip tracking ID
   * @returns Updated tracking object
   *
   * @invalidates tracking:id/{id}, tracking/*
   */
  async retrackById(id: string): Promise<any> {
    const response = await this.sdk.tracking.retrackTrackingById(id);

    // Invalidate caches
    cache.invalidate(createCacheKey("tracking:id", { id }));
    cache.invalidatePattern(/^tracking/);

    return response;
  }

  /**
   * Marks a tracking as completed with a reason.
   *
   * @param id - AfterShip tracking ID
   * @param reason - Completion reason: "DELIVERED", "LOST", or "RETURNED_TO_SENDER"
   * @returns Updated tracking object
   *
   * @invalidates tracking:id/{id}, tracking/*
   */
  async markCompleted(
    id: string,
    reason: "DELIVERED" | "LOST" | "RETURNED_TO_SENDER"
  ): Promise<any> {
    const response = await this.sdk.tracking.markTrackingCompletedById(id, {
      reason,
    });

    // Invalidate caches
    cache.invalidate(createCacheKey("tracking:id", { id }));
    cache.invalidatePattern(/^tracking/);

    return response;
  }

  // ============================================
  // MONITORING OPERATIONS
  // ============================================

  /**
   * Finds shipments with exceptions (delivery issues).
   *
   * @param options - Filter options
   * @param options.limit - Maximum results (default: 100)
   * @param options.days - Lookback period in days (default: 7)
   * @returns Array of trackings with Exception tag
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * const exceptions = await client.findExceptions({ days: 14 });
   */
  async findExceptions(options?: {
    limit?: number;
    days?: number;
  }): Promise<any[]> {
    const days = options?.days || 7;
    const createdAfter = new Date();
    createdAfter.setDate(createdAfter.getDate() - days);

    const cacheKey = createCacheKey("exceptions", {
      limit: options?.limit,
      days,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const response = await this.sdk.tracking.getTrackings({
          tag: "Exception",
          created_at_min: createdAfter.toISOString(),
          limit: options?.limit || 100,
        });

        return response.trackings || [];
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Finds shipments that are delayed past their expected delivery date.
   *
   * Uses carrier-aware delay thresholds:
   * - UPS: 1 day past expected
   * - Royal Mail: 3 days past expected
   * - Freight Carrier: 2 days past expected
   * - Default: 2 days past expected
   *
   * @param options - Filter options
   * @param options.days - Not currently used (threshold is carrier-based)
   * @returns Array of delayed trackings with expected delivery in the past
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * const delayed = await client.findDelayed();
   * // Returns shipments past their expected delivery by carrier threshold
   */
  async findDelayed(options?: { days?: number }): Promise<any[]> {
    const cacheKey = createCacheKey("delayed", { days: options?.days });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // Get all active (non-delivered) trackings
        const response = await this.sdk.tracking.getTrackings({
          limit: 200,
        });

        const now = new Date();
        const trackings = response.trackings || [];

        // Filter to those with expected_delivery in the past
        return trackings.filter((t: any) => {
          // Skip if already delivered or no expected date
          if (t.tag === "Delivered" || t.tag === "Expired") {
            return false;
          }

          // Check various expected delivery date fields
          const expectedDate = t.latest_estimated_delivery?.datetime ||
            t.courier_estimated_delivery_date?.datetime ||
            t.order_promised_delivery_date;

          if (!expectedDate) {
            return false;
          }

          const expected = new Date(expectedDate);
          const slug = (t.slug || "").toLowerCase();

          // Get carrier-specific threshold
          const threshold =
            DELAY_THRESHOLDS[slug] || DELAY_THRESHOLDS["default"];

          // Calculate days overdue
          const daysDiff = Math.floor(
            (now.getTime() - expected.getTime()) / (1000 * 60 * 60 * 24)
          );

          return daysDiff >= threshold;
        });
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Retrieves all active (non-delivered) shipments.
   *
   * Queries across multiple status tags: Pending, InfoReceived, InTransit,
   * OutForDelivery, AttemptFail, AvailableForPickup.
   *
   * @param options - Filter options
   * @param options.limit - Maximum results per tag (default: 50)
   * @param options.slug - Filter by carrier slug
   * @returns Array of active trackings, deduplicated by ID
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * // Get all active shipments
   * const active = await client.getActiveShipments();
   *
   * // Get only UPS active shipments
   * const upsActive = await client.getActiveShipments({ slug: "ups" });
   */
  async getActiveShipments(options?: {
    limit?: number;
    slug?: string;
  }): Promise<any[]> {
    const cacheKey = createCacheKey("active", {
      limit: options?.limit,
      slug: options?.slug,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // Get non-delivered trackings by fetching without Delivered/Expired tags
        const activeTags = [
          "Pending",
          "InfoReceived",
          "InTransit",
          "OutForDelivery",
          "AttemptFail",
          "AvailableForPickup",
        ];

        let allTrackings: any[] = [];

        for (const tag of activeTags) {
          const response = await this.sdk.tracking.getTrackings({
            tag,
            slug: options?.slug,
            limit: options?.limit || 50,
          });
          allTrackings = allTrackings.concat(response.trackings || []);
        }

        // Deduplicate by id
        const seen = new Set<string>();
        return allTrackings.filter((t) => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Retrieves recently delivered shipments.
   *
   * @param options - Filter options
   * @param options.limit - Maximum results (default: 100)
   * @param options.days - Lookback period in days (default: 7)
   * @returns Array of delivered trackings within the time window
   *
   * @cached TTL: 15 minutes
   *
   * @example
   * // Get deliveries from last 7 days
   * const recent = await client.getRecentDeliveries();
   *
   * // Get deliveries from last 30 days
   * const monthly = await client.getRecentDeliveries({ days: 30 });
   */
  async getRecentDeliveries(options?: {
    limit?: number;
    days?: number;
  }): Promise<any[]> {
    const days = options?.days || 7;
    const deliveredAfter = new Date();
    deliveredAfter.setDate(deliveredAfter.getDate() - days);

    const cacheKey = createCacheKey("delivered", {
      limit: options?.limit,
      days,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const response = await this.sdk.tracking.getTrackings({
          tag: "Delivered",
          limit: options?.limit || 100,
        });

        // Filter to those delivered within the time window
        const trackings = response.trackings || [];
        return trackings.filter((t: any) => {
          if (!t.shipment_delivery_date) return true; // Include if no date
          const deliveryDate = new Date(t.shipment_delivery_date);
          return deliveryDate >= deliveredAfter;
        });
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // COURIER OPERATIONS
  // ============================================

  /**
   * Lists available courier/carrier services.
   *
   * @param includeAll - Currently unused (SDK returns all couriers)
   * @returns Array of courier objects with slug, name, and supported features
   *
   * @cached TTL: 1 hour
   *
   * @example
   * const couriers = await client.listCouriers();
   * // Returns: [{ slug: "ups", name: "UPS", ... }, ...]
   */
  async listCouriers(includeAll?: boolean): Promise<any[]> {
    const cacheKey = createCacheKey("couriers", { all: includeAll });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // SDK has single getCouriers method
        const response = await this.sdk.courier.getCouriers();
        return response.couriers || [];
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Auto-detects the carrier from a tracking number.
   *
   * Uses AfterShip's pattern matching to identify possible carriers.
   *
   * @param trackingNumber - The tracking number to analyze
   * @returns Array of possible couriers, ordered by likelihood
   *
   * @cached TTL: 1 day (carrier detection is deterministic)
   *
   * @example
   * const couriers = await client.detectCourier("1Z999AA10123456784");
   * // Returns: [{ slug: "ups", name: "UPS", ... }]
   */
  async detectCourier(trackingNumber: string): Promise<any[]> {
    const cacheKey = createCacheKey("detect", { trackingNumber });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const response = await this.sdk.courier.detectCourier({
          tracking_number: trackingNumber,
        });
        return response.couriers || [];
      },
      { ttl: TTL.DAY, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Smart carrier resolution with fallback to known common carriers.
   *
   * Attempts auto-detection first, then falls back to trying known
   * common carriers (UPS, Royal Mail, Freight Carrier) if detection fails.
   *
   * @param trackingNumber - The tracking number to resolve
   * @returns Object with courier (or null) and method used
   *
   * @example
   * const result = await client.resolveTracking("1Z999AA10123456784");
   * // Returns: { courier: { slug: "ups", ... }, method: "auto-detected" }
   *
   * const unknown = await client.resolveTracking("UNKNOWN123");
   * // Returns: { courier: null, method: "not-found" }
   */
  async resolveTracking(
    trackingNumber: string
  ): Promise<{ courier: any | null; method: string }> {
    // Try auto-detection first
    try {
      const detected = await this.detectCourier(trackingNumber);
      if (detected.length > 0) {
        return { courier: detected[0], method: "auto-detected" };
      }
    } catch {
      // Detection failed, try fallbacks
    }

    // Fallback: try known common carriers
    const knownCarriers = ["ups", "royal-mail", "carrier-freight"];
    for (const slug of knownCarriers) {
      try {
        const tracking = await this.getTrackingByNumber(trackingNumber, slug);
        if (tracking) {
          return {
            courier: { slug, name: slug.replace("-", " ").toUpperCase() },
            method: `fallback-${slug}`,
          };
        }
      } catch {
        // Carrier didn't recognize the tracking number, try next
        continue;
      }
    }

    return { courier: null, method: "not-found" };
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  /**
   * Checks API key validity and connection status.
   *
   * @returns Object with validation status and details
   *
   * @example
   * const status = await client.getApiStatus();
   * // Returns: { valid: true, message: "API key is valid", details: { connected_couriers: 105 } }
   */
  async getApiStatus(): Promise<{
    valid: boolean;
    message: string;
    details?: any;
  }> {
    try {
      // Try a simple API call to verify credentials
      const response = await this.sdk.courier.getCouriers();
      return {
        valid: true,
        message: "API key is valid",
        details: {
          connected_couriers: response.couriers?.length || 0,
        },
      };
    } catch (error: any) {
      return {
        valid: false,
        message: error.message || "API key validation failed",
        details: { error: error.code || "unknown" },
      };
    }
  }

  /**
   * Returns list of available CLI commands for this client.
   *
   * @returns Array of tool definitions with name and description
   */
  getTools(): Array<{ name: string; description: string }> {
    return [
      { name: "list-trackings", description: "List trackings with filters" },
      {
        name: "get-tracking",
        description: "Get tracking by ID or number+slug",
      },
      {
        name: "search-by-order",
        description: "Find tracking by Shopify order number",
      },
      { name: "create-tracking", description: "Create a new tracking" },
      { name: "update-tracking", description: "Update tracking metadata" },
      { name: "delete-tracking", description: "Delete a tracking" },
      { name: "retrack", description: "Retrack an expired tracking" },
      { name: "mark-completed", description: "Mark tracking as completed" },
      {
        name: "find-exceptions",
        description: "Find trackings with exceptions",
      },
      {
        name: "find-delayed",
        description: "Find overdue shipments (carrier-aware)",
      },
      {
        name: "active-shipments",
        description: "List all non-delivered trackings",
      },
      {
        name: "recent-deliveries",
        description: "List recently delivered trackings",
      },
      { name: "list-couriers", description: "List available couriers" },
      {
        name: "detect-courier",
        description: "Detect courier from tracking number",
      },
      {
        name: "resolve-tracking",
        description: "Smart detection with carrier fallback",
      },
      { name: "api-status", description: "Check API key validity" },
      { name: "cache-stats", description: "Show cache statistics" },
      { name: "cache-clear", description: "Clear all cached data" },
      {
        name: "cache-invalidate",
        description: "Invalidate cache key or order",
      },
    ];
  }
}

export default AfterShipClient;
