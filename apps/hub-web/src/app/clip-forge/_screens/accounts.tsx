"use client";

import { useEffect, useState } from "react";
import { Card, PersonaChip, StatusPill } from "../_components/atoms";
import { AddAccountModal } from "../_components/add-account-modal";
import type { CfAccount, CfData, CfDist } from "../_lib/types";

interface Props {
  data: CfData;
  onChange: () => void;
}

export function AccountsScreen({ data, onChange }: Props) {
  const [selId, setSelId] = useState<string>(data.accounts[0]?.id ?? "");
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    if (!selId && data.accounts[0]) setSelId(data.accounts[0].id);
  }, [data.accounts, selId]);
  const sel = data.accounts.find((a) => a.id === selId);
  const accounts = data.accounts;

  // NOTE: there is deliberately no toggle handler here. The account `active`
  // flag is owned by the worker ledger and there is no PATCH endpoint for
  // accounts, so the previous switch control was a pure no-op that looked
  // interactive. It is now rendered as a read-only status badge.

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #1d232a",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 16px",
            borderBottom: "1px solid #1d232a",
            background: "#0b0e12",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600 }}>Account Fleet</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#7d8893",
            }}
          >
            {accounts.length} total · {accounts.filter((a) => a.active).length}{" "}
            active
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setAddOpen(true)}
            style={{
              border: "1px solid #3f4954",
              background: "#1a212a",
              color: "#eef1f4",
              borderRadius: 5,
              padding: "4px 11px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          >
            + add account
          </button>
        </div>
        <AddAccountModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={onChange}
        />
        <div
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns:
              "minmax(130px,1fr) 84px 78px 46px 150px 120px 96px",
            padding: "7px 16px",
            borderBottom: "1px solid #1d232a",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            letterSpacing: ".06em",
            color: "#59616a",
            background: "#0b0e12",
          }}
        >
          <span>HANDLE</span>
          <span>PLATFORM</span>
          <span>SEED</span>
          <span>PPD</span>
          <span>PROXY</span>
          <span>PROFILE</span>
          <span style={{ textAlign: "right" }}>HEALTH</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {accounts.map((a) => {
            const active = a.id === selId;
            const healthC = a.flag
              ? "#cf7468"
              : a.active
                ? "#57a578"
                : "#515b66";
            const healthT = a.flag
              ? "flagged"
              : a.active
                ? "ok · " + a.last
                : "inactive";
            return (
              <div
                key={a.id}
                onClick={() => setSelId(a.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(130px,1fr) 84px 78px 46px 150px 120px 96px",
                  alignItems: "center",
                  padding: "7px 16px 7px 14px",
                  borderBottom: "1px solid #14181d",
                  cursor: "pointer",
                  background: active ? "#13181f" : "transparent",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <PersonaChip name={a.persona} size={20} />
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11.5,
                      color: "#cfd4da",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {a.handle}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: "#9aa1a9" }}>
                  {a.platform}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: "#7d8893",
                  }}
                >
                  {a.seed}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#cfd4da",
                  }}
                >
                  {a.ppd}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: a.proxy ? "#9aa1a9" : "#515b66",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    paddingRight: 8,
                  }}
                >
                  {a.proxy || "not set"}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: a.profile ? "#9aa1a9" : "#515b66",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    paddingRight: 8,
                  }}
                >
                  {a.profile || "not set"}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 7,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9.5,
                      color: healthC,
                    }}
                  >
                    {healthT}
                  </span>
                  {/* Read-only: was a switch with cursor:pointer wired to a
                      no-op handler. The active flag is owned by the worker
                      ledger; no PATCH endpoint exists for accounts. */}
                  <span
                    title="read-only · owned by the worker ledger"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9,
                      letterSpacing: ".06em",
                      color: a.active ? "#57a578" : "#6b727b",
                      background: a.active
                        ? "rgba(87,165,120,.13)"
                        : "rgba(107,114,123,.13)",
                      border: `1px solid ${a.active ? "#2f5a41" : "#2b333c"}`,
                      borderRadius: 3,
                      padding: "1px 5px",
                      flex: "0 0 auto",
                    }}
                  >
                    {a.active ? "ON" : "OFF"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ width: 340, flex: "0 0 340px", overflow: "auto" }}>
        {sel && <AccountDetail account={sel} dists={data.dists} />}
      </div>
    </div>
  );
}

function AccountDetail({
  account,
  dists,
}: {
  account: CfAccount;
  dists: CfDist[];
}) {
  const a = account;
  const healthC = a.flag ? "#cf7468" : a.active ? "#57a578" : "#515b66";
  const healthBg = healthC + "22";
  const healthT = a.flag
    ? "flagged · review"
    : a.active
      ? "healthy"
      : "inactive";
  // REMOVED: `curve` (a 16-point sine wave built from the account's single
  // lifetime viewsK total) and `catMix` (a fixed 40/33/26/19/12% split that
  // was identical for every account). Neither had a data source — CfData
  // carries no time series, and the real cf_accounts.category_mix column is
  // not plumbed into CfAccount. Both panels now show empty states.
  // REMOVED: the synthetic `posts` array (fake clip_2xxxx ids, and
  // `views: Math.random()*120` which re-rolled on every 4s poll). Real
  // distributions for this account are filtered out of data.dists instead.
  const posts = dists.filter((d) => d.account === a.id);

  return (
    <div
      style={{
        padding: "15px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 15,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PersonaChip name={a.persona} size={32} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              fontWeight: 600,
              color: "#eef1f4",
            }}
          >
            {a.handle}
          </div>
          <div style={{ fontSize: 10.5, color: "#7d8893" }}>
            {a.platform} · {a.persona}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: healthC,
            background: healthBg,
            padding: "3px 9px",
            borderRadius: 4,
          }}
        >
          {healthT}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        <Card pad={11} style={{ borderRadius: 6 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: ".1em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            VARIANT SEED
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              color: "#cfd4da",
              marginTop: 3,
            }}
          >
            {a.seed}
          </div>
        </Card>
        <Card pad={11} style={{ borderRadius: 6 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: ".1em",
              color: "#59616a",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            POSTS / DAY
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              color: "#cfd4da",
              marginTop: 3,
            }}
          >
            {a.ppd}
          </div>
        </Card>
      </div>

      <div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: ".12em",
            color: "#59616a",
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 8,
          }}
        >
          ISOLATION IDENTITY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {[
            ["proxy", a.proxy || "not set"],
            ["profile", a.profile || "not set"],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                border: "1px solid #232a32",
                borderRadius: 6,
                background: "#10141a",
                padding: "7px 10px",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "#59616a",
                  fontFamily: "'IBM Plex Mono', monospace",
                  width: 52,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  flex: 1,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: value === "not set" ? "#515b66" : "#9aa1a9",
                }}
              >
                {value}
              </span>
              {/* REMOVED: an "edit" affordance that had no handler and no
                  backing endpoint (there is no PATCH for accounts). */}
            </div>
          ))}
        </div>
      </div>

      <Card pad={13}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 600 }}>View trend</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: "#9aa1a9",
            }}
          >
            {a.viewsK}k total
          </span>
        </div>
        {/* Was a 16-point sparkline generated from sin(i/2) — pure decoration.
            No view time series is collected anywhere, so we say so. */}
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            border: "1px dashed #232a32",
            borderRadius: 5,
            fontSize: 10.5,
            color: "#59616a",
            padding: "0 10px",
          }}
        >
          no view history — only the lifetime total is recorded
        </div>
      </Card>

      <div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: ".12em",
            color: "#59616a",
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 8,
          }}
        >
          CATEGORY MIX
        </div>
        {/* Was five hardcoded bars (40/33/26/19/12%) — identical for every
            account, so it conveyed nothing. cf_accounts.category_mix holds
            the real value but is not exposed on CfAccount yet. */}
        <div
          style={{
            border: "1px dashed #232a32",
            borderRadius: 5,
            padding: "12px 10px",
            fontSize: 10.5,
            color: "#59616a",
            textAlign: "center",
          }}
        >
          no category mix configured for this account
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: ".12em",
            color: "#59616a",
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 8,
          }}
        >
          RECENT / SCHEDULED POSTS
        </div>
        <Card pad={0} style={{ overflow: "hidden" }}>
          {posts.length === 0 && (
            <div
              style={{
                padding: "18px 12px",
                textAlign: "center",
                fontSize: 10.5,
                color: "#59616a",
              }}
            >
              no distributions for this account yet
            </div>
          )}
          {posts.slice(0, 12).map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 11px",
                borderBottom: "1px solid #14181d",
              }}
            >
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10.5,
                  color: "#9aa1a9",
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.clip}
              </span>
              <StatusPill status={p.status} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9.5,
                  color: "#9aa1a9",
                  width: 46,
                  textAlign: "right",
                }}
              >
                {p.viewsK ? p.viewsK + "k" : "—"}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
