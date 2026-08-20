import { describe, it, expect } from "vitest";
import {
  assignmentSpecificity,
  assignmentMatches,
  pickAssignment,
  selectTracks,
  type ResolvableAssignment,
  type SelectableTrack,
} from "../resolve";

function asg(over: Partial<ResolvableAssignment> = {}): ResolvableAssignment {
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
const OTHER_CH = "22222222-2222-2222-2222-222222222222";

describe("assignmentSpecificity", () => {
  it("ranks format+channel above channel above format above global", () => {
    expect(assignmentSpecificity({ format: "CE", channel_id: CH })).toBe(3);
    expect(assignmentSpecificity({ format: null, channel_id: CH })).toBe(2);
    expect(assignmentSpecificity({ format: "CE", channel_id: null })).toBe(1);
    expect(assignmentSpecificity({ format: null, channel_id: null })).toBe(0);
  });
});

describe("assignmentMatches", () => {
  it("matches a global assignment against any scope", () => {
    expect(assignmentMatches(asg(), { format: "CE", channelId: CH })).toBe(
      true,
    );
    expect(assignmentMatches(asg(), {})).toBe(true);
  });

  it("does not match a different format", () => {
    expect(
      assignmentMatches(asg({ format: "CE" }), { format: "RANKING" }),
    ).toBe(false);
  });

  it("does not match a different channel", () => {
    expect(
      assignmentMatches(asg({ channel_id: CH }), { channelId: OTHER_CH }),
    ).toBe(false);
  });

  it("does not match a format-scoped assignment when no format is requested", () => {
    expect(assignmentMatches(asg({ format: "CE" }), {})).toBe(false);
  });

  it("ignores inactive assignments", () => {
    expect(assignmentMatches(asg({ is_active: false }), {})).toBe(false);
  });
});

describe("pickAssignment", () => {
  const global = asg({ id: "g", collection_id: "cg" });
  const byFormat = asg({ id: "f", collection_id: "cf", format: "CE" });
  const byChannel = asg({ id: "c", collection_id: "cc", channel_id: CH });
  const both = asg({
    id: "b",
    collection_id: "cb",
    format: "CE",
    channel_id: CH,
  });

  it("returns null when nothing applies", () => {
    expect(pickAssignment([byFormat], { format: "RANKING" })).toBeNull();
    expect(pickAssignment([], {})).toBeNull();
  });

  it("falls back to the global default", () => {
    expect(pickAssignment([global], { format: "CE", channelId: CH })?.id).toBe(
      "g",
    );
  });

  it("prefers a format binding over the global default", () => {
    expect(pickAssignment([global, byFormat], { format: "CE" })?.id).toBe("f");
  });

  it("prefers a channel binding over a format binding", () => {
    expect(
      pickAssignment([global, byFormat, byChannel], {
        format: "CE",
        channelId: CH,
      })?.id,
    ).toBe("c");
  });

  it("prefers the most specific format+channel binding of all", () => {
    expect(
      pickAssignment([global, byFormat, byChannel, both], {
        format: "CE",
        channelId: CH,
      })?.id,
    ).toBe("b");
  });

  it("is order-independent", () => {
    const all = [both, global, byChannel, byFormat];
    const scope = { format: "CE", channelId: CH };
    expect(pickAssignment(all, scope)?.id).toBe("b");
    expect(pickAssignment([...all].reverse(), scope)?.id).toBe("b");
  });

  it("skips an inactive specific binding and uses the next best", () => {
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

describe("selectTracks", () => {
  const tracks: SelectableTrack[] = [
    { id: "t1", duration_seconds: 100, sort_order: 3 },
    { id: "t2", duration_seconds: 200, sort_order: 1 },
    { id: "t3", duration_seconds: 300, sort_order: 2 },
  ];

  it("stops as soon as the target is covered", () => {
    const r = selectTracks({
      tracks,
      targetSeconds: 250,
      mode: "sequential",
    });
    // sort_order 1 (200s) then 2 (300s) => 500s, stops there
    expect(r.tracks.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(r.totalSeconds).toBe(500);
    expect(r.short).toBe(false);
  });

  it("honours sequential order by sort_order", () => {
    const r = selectTracks({
      tracks,
      targetSeconds: 10000,
      mode: "sequential",
    });
    expect(r.tracks.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("honours longest_first", () => {
    const r = selectTracks({
      tracks,
      targetSeconds: 10000,
      mode: "longest_first",
    });
    expect(r.tracks.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
  });

  it("reports short instead of repeating tracks to hit the target", () => {
    const r = selectTracks({
      tracks,
      targetSeconds: 5000,
      mode: "sequential",
    });
    expect(r.tracks).toHaveLength(3);
    expect(r.totalSeconds).toBe(600);
    expect(r.short).toBe(true);
  });

  it("skips tracks with a non-positive duration", () => {
    const r = selectTracks({
      tracks: [
        { id: "bad", duration_seconds: 0, sort_order: 0 },
        { id: "good", duration_seconds: 50, sort_order: 1 },
      ],
      targetSeconds: 10,
      mode: "sequential",
    });
    expect(r.tracks.map((t) => t.id)).toEqual(["good"]);
  });

  it("returns an empty short result for an empty pool", () => {
    const r = selectTracks({ tracks: [], targetSeconds: 60, mode: "random" });
    expect(r.tracks).toEqual([]);
    expect(r.totalSeconds).toBe(0);
    expect(r.short).toBe(true);
  });

  it("uses the injected rng in random mode, deterministically", () => {
    // rng always 0 => Fisher-Yates swaps every element toward index 0,
    // producing a fixed permutation for a fixed rng.
    const a = selectTracks({
      tracks,
      targetSeconds: 10000,
      mode: "random",
      rng: () => 0,
    });
    const b = selectTracks({
      tracks,
      targetSeconds: 10000,
      mode: "random",
      rng: () => 0,
    });
    expect(a.tracks.map((t) => t.id)).toEqual(b.tracks.map((t) => t.id));
    expect(a.tracks).toHaveLength(3);
  });

  it("defaults an unknown mode to random rather than throwing", () => {
    const r = selectTracks({
      tracks,
      targetSeconds: 10000,
      mode: "nonsense",
      rng: () => 0,
    });
    expect(r.tracks).toHaveLength(3);
  });

  it("treats a zero target as already satisfied", () => {
    const r = selectTracks({ tracks, targetSeconds: 0, mode: "sequential" });
    expect(r.tracks).toEqual([]);
    expect(r.short).toBe(false);
  });
});
