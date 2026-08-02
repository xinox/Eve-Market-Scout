import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateOrders } from "./aggregate.js";
import type { EsiMarketOrder } from "@eve-market-scout/shared";

function makeOrder(overrides: Partial<EsiMarketOrder>): EsiMarketOrder {
  return {
    order_id: 1,
    type_id: 34,
    region_id: 10000002,
    location_id: 60003760,
    system_id: 30000142,
    is_buy_order: false,
    price: 5,
    volume_remain: 1000,
    volume_total: 1000,
    min_volume: 1,
    duration: 90,
    issued: new Date().toISOString(),
    range: "region",
    ...overrides,
  };
}

test("picks the lowest sell price as bestSell", () => {
  const orders = [
    makeOrder({ order_id: 1, price: 5.2, volume_remain: 100 }),
    makeOrder({ order_id: 2, price: 4.9, volume_remain: 200 }),
    makeOrder({ order_id: 3, price: 5.5, volume_remain: 50 }),
  ];
  const rows = aggregateOrders(orders, "2026-07-26T00:00:00Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bestSell, 4.9);
  assert.equal(rows[0].sellVolume, 350);
  assert.equal(rows[0].sellOrderCount, 3);
});

test("picks the highest buy price as bestBuy, tracked separately from sells", () => {
  const orders = [
    makeOrder({ order_id: 1, is_buy_order: true, price: 4.0, volume_remain: 500 }),
    makeOrder({ order_id: 2, is_buy_order: true, price: 4.3, volume_remain: 300 }),
    makeOrder({ order_id: 3, is_buy_order: false, price: 5.0, volume_remain: 100 }),
  ];
  const rows = aggregateOrders(orders, "2026-07-26T00:00:00Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bestBuy, 4.3);
  assert.equal(rows[0].bestSell, 5.0);
  assert.equal(rows[0].buyVolume, 800);
});

test("keeps separate rows per type_id", () => {
  const orders = [
    makeOrder({ order_id: 1, type_id: 34, price: 5 }),
    makeOrder({ order_id: 2, type_id: 35, price: 8 }),
  ];
  const rows = aggregateOrders(orders, "2026-07-26T00:00:00Z");
  assert.equal(rows.length, 2);
});

test("returns empty array for empty input", () => {
  assert.deepEqual(aggregateOrders([], "2026-07-26T00:00:00Z"), []);
});

test("tracks the location/system of the order that set bestSell/bestBuy", () => {
  const orders = [
    makeOrder({ order_id: 1, price: 5.2, location_id: 111, system_id: 222 }),
    makeOrder({ order_id: 2, price: 4.9, location_id: 333, system_id: 444 }),
    makeOrder({ order_id: 3, is_buy_order: true, price: 4.0, location_id: 555, system_id: 666 }),
  ];
  const rows = aggregateOrders(orders, "2026-07-26T00:00:00Z");
  assert.equal(rows[0].bestSellLocationId, 333);
  assert.equal(rows[0].bestSellSystemId, 444);
  assert.equal(rows[0].bestBuyLocationId, 555);
  assert.equal(rows[0].bestBuySystemId, 666);
});
