#!/usr/bin/env npx tsx
/**
 * AfterShip Tracking CLI
 *
 * Zod-validated CLI for AfterShip shipment tracking.
 */

import { z, createCommand, runCli, cacheCommands, cliTypes } from "@local/cli-utils";
import { AfterShipClient } from "./aftership-client.js";

// Define commands with Zod schemas
const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: AfterShipClient) => client.getTools(),
    "List all available commands"
  ),

  // Tracking commands
  "list-trackings": createCommand(
    z.object({
      status: z.string().optional().describe("Filter by status tag (InTransit, Delivered, etc.)"),
      slug: z.string().optional().describe("Filter by courier slug (e.g., ups, royal-mail)"),
      orderId: z.string().optional().describe("Filter by order ID"),
      createdAfter: z.string().optional().describe("Filter by created date (ISO 8601)"),
      createdBefore: z.string().optional().describe("Filter by created date (ISO 8601)"),
      limit: cliTypes.int(1, 200).optional().describe("Max results to return"),
    }),
    async (args, client: AfterShipClient) => {
      const { status, slug, orderId, createdAfter, createdBefore, limit } = args as {
        status?: string;
        slug?: string;
        orderId?: string;
        createdAfter?: string;
        createdBefore?: string;
        limit?: number;
      };
      return client.listTrackings({
        tag: status,
        slug,
        order_id: orderId,
        created_at_min: createdAfter,
        created_at_max: createdBefore,
        limit,
      });
    },
    "List trackings with filters"
  ),

  "get-tracking": createCommand(
    z.object({
      id: z.string().optional().describe("Tracking ID"),
      trackingNumber: z.string().optional().describe("Tracking number"),
      slug: z.string().optional().describe("Courier slug (required with tracking-number)"),
    }).refine(
      (data) => data.id !== undefined || (data.trackingNumber !== undefined && data.slug !== undefined),
      { message: "Either --id OR (--tracking-number AND --slug) is required" }
    ),
    async (args, client: AfterShipClient) => {
      const { id, trackingNumber, slug } = args as {
        id?: string;
        trackingNumber?: string;
        slug?: string;
      };
      if (id) {
        return client.getTrackingById(id);
      }
      return client.getTrackingByNumber(trackingNumber!, slug!);
    },
    "Get tracking details"
  ),

  "search-by-order": createCommand(
    z.object({
      order: z.string().min(1).describe("Shopify order number"),
    }),
    async (args, client: AfterShipClient) => {
      const { order } = args as { order: string };
      return client.searchByOrderId(order);
    },
    "Find tracking by Shopify order number"
  ),

  "create-tracking": createCommand(
    z.object({
      trackingNumber: z.string().min(1).describe("Tracking number"),
      slug: z.string().optional().describe("Courier slug (auto-detected if omitted)"),
      orderId: z.string().optional().describe("Order ID for reference"),
      title: z.string().optional().describe("Tracking title"),
      customFields: z.string().optional().describe("Custom fields as JSON string, e.g. '{\"direction\":\"inbound\",\"vendor\":\"Acme\"}'"),
    }),
    async (args, client: AfterShipClient) => {
      const { trackingNumber, slug, orderId, title, customFields } = args as {
        trackingNumber: string;
        slug?: string;
        orderId?: string;
        title?: string;
        customFields?: string;
      };

      // Parse custom fields if provided
      let parsedCustomFields: Record<string, string> | undefined;
      if (customFields) {
        try {
          parsedCustomFields = JSON.parse(customFields);
        } catch (e) {
          throw new Error(`Invalid JSON for customFields: ${customFields}`);
        }
      }

      return client.createTracking({
        tracking_number: trackingNumber,
        slug,
        order_id: orderId,
        title,
        custom_fields: parsedCustomFields,
      });
    },
    "Create a new tracking"
  ),

  "update-tracking": createCommand(
    z.object({
      id: z.string().min(1).describe("Tracking ID"),
      title: z.string().optional().describe("New title"),
      orderId: z.string().optional().describe("New order ID"),
    }),
    async (args, client: AfterShipClient) => {
      const { id, title, orderId } = args as {
        id: string;
        title?: string;
        orderId?: string;
      };
      return client.updateTracking(id, { title, order_id: orderId });
    },
    "Update tracking metadata"
  ),

  "delete-tracking": createCommand(
    z.object({
      id: z.string().min(1).describe("Tracking ID"),
    }),
    async (args, client: AfterShipClient) => {
      const { id } = args as { id: string };
      await client.deleteTracking(id);
      return { success: true, deleted: id };
    },
    "Delete a tracking"
  ),

  "retrack": createCommand(
    z.object({
      id: z.string().min(1).describe("Tracking ID"),
    }),
    async (args, client: AfterShipClient) => {
      const { id } = args as { id: string };
      return client.retrackById(id);
    },
    "Retrack an expired tracking"
  ),

  "mark-completed": createCommand(
    z.object({
      id: z.string().min(1).describe("Tracking ID"),
      reason: z.enum(["DELIVERED", "LOST", "RETURNED_TO_SENDER"]).default("DELIVERED").describe("Completion reason"),
    }),
    async (args, client: AfterShipClient) => {
      const { id, reason } = args as {
        id: string;
        reason: "DELIVERED" | "LOST" | "RETURNED_TO_SENDER";
      };
      return client.markCompleted(id, reason);
    },
    "Mark tracking as completed"
  ),

  // Monitoring commands
  "find-exceptions": createCommand(
    z.object({
      limit: cliTypes.int(1, 100).optional().describe("Max results to return"),
      days: cliTypes.int(1, 90).optional().describe("Lookback period in days"),
    }),
    async (args, client: AfterShipClient) => {
      const { limit, days } = args as { limit?: number; days?: number };
      return client.findExceptions({ limit, days });
    },
    "Find trackings with exceptions"
  ),

  "find-delayed": createCommand(
    z.object({
      days: cliTypes.int(1, 90).optional().describe("Expected delivery threshold in days"),
    }),
    async (args, client: AfterShipClient) => {
      const { days } = args as { days?: number };
      return client.findDelayed({ days });
    },
    "Find overdue shipments (carrier-aware)"
  ),

  "active-shipments": createCommand(
    z.object({
      limit: cliTypes.int(1, 200).optional().describe("Max results to return"),
      slug: z.string().optional().describe("Filter by courier slug"),
    }),
    async (args, client: AfterShipClient) => {
      const { limit, slug } = args as { limit?: number; slug?: string };
      return client.getActiveShipments({ limit, slug });
    },
    "List all non-delivered trackings"
  ),

  "recent-deliveries": createCommand(
    z.object({
      limit: cliTypes.int(1, 100).optional().describe("Max results to return"),
      days: cliTypes.int(1, 30).optional().describe("Lookback period in days"),
    }),
    async (args, client: AfterShipClient) => {
      const { limit, days } = args as { limit?: number; days?: number };
      return client.getRecentDeliveries({ limit, days });
    },
    "List recently delivered trackings"
  ),

  // Courier commands
  "list-couriers": createCommand(
    z.object({
      all: cliTypes.bool().optional().describe("Include all couriers (not just enabled)"),
    }),
    async (args, client: AfterShipClient) => {
      const { all } = args as { all?: boolean };
      return client.listCouriers(all === true);
    },
    "List available couriers"
  ),

  "detect-courier": createCommand(
    z.object({
      trackingNumber: z.string().min(1).describe("Tracking number"),
    }),
    async (args, client: AfterShipClient) => {
      const { trackingNumber } = args as { trackingNumber: string };
      return client.detectCourier(trackingNumber);
    },
    "Detect courier from tracking number"
  ),

  "resolve-tracking": createCommand(
    z.object({
      trackingNumber: z.string().min(1).describe("Tracking number"),
    }),
    async (args, client: AfterShipClient) => {
      const { trackingNumber } = args as { trackingNumber: string };
      return client.resolveTracking(trackingNumber);
    },
    "Smart detection with carrier fallback"
  ),

  // Utility commands
  "api-status": createCommand(
    z.object({}),
    async (_args, client: AfterShipClient) => client.getApiStatus(),
    "Check API key validity and rate limits"
  ),

  // Pre-built cache commands
  ...cacheCommands<AfterShipClient>(),
};

// Run CLI
runCli(commands, AfterShipClient, {
  programName: "aftership-cli",
  description: "AfterShip shipment tracking",
});
