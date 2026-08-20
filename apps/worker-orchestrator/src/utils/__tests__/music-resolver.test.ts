import { describe, it, expect } from "vitest";
import {
  specificity,
  matches,
  pickAssignment,
  orderTracks,
} from "../music-resolver.js";

interface Row {
  id: string;
  collection_id: string;
  format: string | null;
  channel_id: string | null;
  is_active: boolean;
  selection_mode: string;
  volume_db: number;
}

function asg(over: Partial<Row> = {}): Row {
  return {
    id: "a",
    collection_id: "c",
    format: null,
    channel_id: null,
    is_active: true,
    selection_mode: "random",
    volume_db: -18,
    ...over,
  };
}

const CH = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("specificity", () => {
  it("ranks format+channel > channel > format > global", () => {
    expect(specificity({ format: "CE", channel_id: CH })).toBe(3);
    expect(specificity({ format: null, channel_id: CH })).toBe(2);
    expect(specificity({ format: "CE", channel_id: null })).toBe(1);
    expect(specificity({ format: null, channel_id: null })).toBe(0);
  });
});

describe("matches", () => {
  it("matches a global assignment against any scope", () => {
    expect(matches(asg(), { format: "CE", channelId: CH })).toBe(true);
  });

  it("rejects a mismatched format or channel", () => {
    expect(matches(asg({ format: "CE" }), { format: "RANKING" })).toBe(false);
    expect(matches(asg({ channel_id: CH }), { channelId: OTHER })).toBe(false);
  });

  it("rejects a format-scoped assignment when no format is requested", () => {
    expect(matches(asg({ format: "CE" }), {})).toBe(false);
  });

  it("rejects inactive assignments", () => {
    expect(matches(asg({ is_active: false }), {})).toBe(false);
  });
});

describe("pickAssignment", () => {
  const global = asg({ id: "g" });
  const byFormat = asg({ id: "f", format: "CE" });
  const byChannel = asg({ id: "c", channel_id: CH });
  const both = asg({ id: "b", format: "CE", channel_id: CH });

  it("returns null when nothing applies", () => {
    expect(pickAssignment([byFormat], { format: "RANKING" })).toBeNull();
    expect(pickAssignment([], {})).toBeNull();
  });

  it("picks the most specific applicable assignment", () => {
    const scope = { format: "CE", channelId: CH };
    expect(pickAssignment([global], scope)?.id).toBe("g");
    expect(pickAssignment([global, byFormat], scope)?.id).toBe("f");
    expect(pickAssignment([global, byFormat, byChannel], scope)?.id).toBe("c");
    expect(
      pickAssignment([global, byFormat, byChannel, both], scope)?.id,
    ).toBe("b");
  });

  it("is order-independent", () => {
    const scope = { format: "CE", channelId: CH };
    const all = [both, global, byChannel, byFormat];
    expect(pickAssignment(all, scope)?.id).toBe("b");
    expect(pickAssignment([...all].reverse(), scope)?.id).toBe("b");
  });

  it("falls through an inactive specific binding", () => {
    expect(
      pickAssignment(
        [global, asg({ id: "f", format: "CE", is_active: false })],
        { format: "CE" },
      )?.id,
    ).toBe("g");
  });

  it("breaks ties deterministically by id", () => {
    const a = asg({ id: "aaa", format: "CE" });
    const b = asg({ id: "bbb", format: "CE" });
    expect(pickAssignment([a, b], { format: "CE" })?.id).toBe("aaa");
    expect(pickAssignment([b, a], { format: "CE" })?.id).toBe("aaa");
  });
});

describe("orderTracks", () => {
  const tracks = [
    { id: "t1", duration_seconds: 100, sort_order: 3 },
    { id: "t2", duration_seconds: 200, sort_order: 1 },
    { id: "t3", duration_seconds: 300, sort_order: 2 },
  ];

  it("orders sequentially by sort_order", () => {
    expect(orderTracks(tracks, "sequential").map((t) => t.id)).toEqual([
      "t2",
      "t3",
      "t1",
    ]);
  });

  it("orders longest first", () => {
    expect(orderTracks(tracks, "longest_first").map((t) => t.id)).toEqual([
      "t3",
      "t2",
      "t1",
    ]);
  });

  it("drops non-positive durations in every mode", () => {
    const withBad = [...tracks, { id: "bad", duration_seconds: 0, sort_order: 0 }];
    for (const mode of ["sequential", "longest_first", "random"]) {
      expect(orderTracks(withBad, mode, () => 0).map((t) => t.id)).not.toContain(
        "bad",
      );
    }
  });

  it("is deterministic in random mode for a fixed rng", () => {
    const a = orderTracks(tracks, "random", () => 0).map((t) => t.id);
    const b = orderTracks(tracks, "random", () => 0).map((t) => t.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it("keeps every track when shuffling", () => {
    const ids = orderTracks(tracks, "random", () => 0.5)
      .map((t) => t.id)
      .sort();
    expect(ids).toEqual(["t1", "t2", "t3"]);
  });

  it("treats an unknown mode as random rather than throwing", () => {
    expect(orderTracks(tracks, "nonsense", () => 0)).toHaveLength(3);
  });

  it("handles an empty pool", () => {
    expect(orderTracks([], "sequential")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = [...tracks];
    orderTracks(input, "longest_first");
    expect(input.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });
});
