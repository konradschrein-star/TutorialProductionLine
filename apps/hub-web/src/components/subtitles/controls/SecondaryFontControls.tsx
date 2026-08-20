"use client";
import React from "react";
import { Segmented, Toggle, FontFamilySelect } from "../primitives";
import type { RemotionControlProps } from "./types";

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

export function SecondaryFontControls({
  config,
  onChange,
  disabled,
  fonts = [],
}: RemotionControlProps) {
  const enabled = config.secondaryFont != null;
  const sec = config.secondaryFont;

  return (
    <>
      <Toggle
        label="Use a secondary font for non-keyword words"
        checked={enabled}
        disabled={disabled}
        onChange={(on) =>
          onChange({
            secondaryFont: on
              ? { fontId: null, fontFamily: config.fontFamily, fontWeight: 400 }
              : null,
          })
        }
      />
      {enabled && sec && (
        <>
          <FontFamilySelect
            label="Secondary Family"
            fonts={fonts}
            valueFontId={sec.fontId}
            valueFontFamily={sec.fontFamily}
            disabled={disabled}
            onChange={(next) =>
              onChange({
                secondaryFont: {
                  ...sec,
                  fontId: next.fontId,
                  fontFamily: next.fontFamily,
                },
              })
            }
          />
          <Segmented
            label="Secondary Weight"
            options={WEIGHTS.map((w) => ({
              value: String(w),
              label: String(w),
            }))}
            value={String(sec.fontWeight)}
            disabled={disabled}
            onChange={(v) =>
              onChange({ secondaryFont: { ...sec, fontWeight: Number(v) } })
            }
          />
        </>
      )}
    </>
  );
}
