"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ContentFormat } from "@repo/contracts";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

interface Channel {
  id: string;
  name: string;
  youtube_channel_id: string;
  language: string;
}

// Sourced from the canonical `ContentFormat` enum
// (`packages/contracts/src/enums/content-format.ts`) rather than a hand-copied
// local list, so this filter never silently drops a live format.
const ALL_FORMATS = ContentFormat.options;

interface Archetype {
  id: string;
  name: string;
  image_style: string | null;
}

interface StyleCollectionFormProps {
  channels: Channel[];
  archetypes: Archetype[];
  initialData?: {
    id: string;
    name: string;
    description: string;
    channel_id: string | null;
    archetype_id: string | null;
    format: string | null;
    text_guidelines: string | null;
  };
}

interface UploadedImage {
  file: File;
  preview: string;
  ref_type: string;
}

export function StyleCollectionForm({
  channels,
  archetypes,
  initialData,
}: StyleCollectionFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [channelId, setChannelId] = useState<string>(
    initialData?.channel_id ?? "",
  );
  const [archetypeId, setArchetypeId] = useState<string>(
    initialData?.archetype_id ?? "",
  );
  const [format, setFormat] = useState<string>(initialData?.format ?? "");
  const [textGuidelines, setTextGuidelines] = useState(
    initialData?.text_guidelines ?? "",
  );
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);

  // UI state
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle image uploads
  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter((f) => f.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setError("Please upload image files only");
      return;
    }

    const newImages: UploadedImage[] = imageFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      ref_type: "style_guide", // Default ref type
    }));

    setUploadedImages((prev) => [...prev, ...newImages]);
    setError(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles],
  );

  const removeImage = (index: number) => {
    setUploadedImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  const updateRefType = (index: number, refType: string) => {
    setUploadedImages((prev) => {
      const newImages = [...prev];
      newImages[index].ref_type = refType;
      return newImages;
    });
  };

  // Save collection
  const handleSave = async () => {
    // Validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!description.trim()) {
      setError("Description is required");
      return;
    }
    if (uploadedImages.length === 0 && !initialData) {
      setError("At least one reference image is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Step 1: Create/update the style collection
      const collectionData = {
        name: name.trim(),
        description: description.trim(),
        channel_id: channelId || null,
        archetype_id: archetypeId || null,
        format: format || null,
        text_guidelines: textGuidelines.trim() || null,
      };

      const collectionRes = initialData
        ? await fetch(`/api/style-collections/${initialData.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(collectionData),
          })
        : await fetch("/api/style-collections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(collectionData),
          });

      if (!collectionRes.ok) {
        const errData = await collectionRes.json();
        throw new Error(errData.error || "Failed to save collection");
      }

      const { collection } = await collectionRes.json();

      // Step 2: Upload images if any
      if (uploadedImages.length > 0) {
        for (const image of uploadedImages) {
          const formData = new FormData();
          formData.append("file", image.file);
          formData.append("ref_type", image.ref_type);

          const uploadRes = await fetch(
            `/api/style-collections/${collection.id}/assets`,
            {
              method: "POST",
              body: formData,
            },
          );

          if (!uploadRes.ok) {
            const errData = await uploadRes.json();
            console.warn("Failed to upload image:", errData.error);
            // Continue with other images
          }
        }
      }

      // Success - navigate back
      router.push("/style-collections");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save collection",
      );
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: 12,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            color: "#f87171",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Basic Info */}
      <GlassCard style={{ padding: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: "0 0 16px 0",
          }}
        >
          Basic Information
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#cdc3d7",
                marginBottom: 8,
              }}
            >
              Collection Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Minimalist Tech, Vibrant Documentary"
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 12,
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#cdc3d7",
                marginBottom: 8,
              }}
            >
              Description *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the visual style, use cases, and intended feel"
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 12,
                resize: "vertical",
              }}
            />
          </div>
        </div>
      </GlassCard>

      {/* Scope Configuration */}
      <GlassCard style={{ padding: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: "0 0 8px 0",
          }}
        >
          Scope (Optional)
        </h3>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.6)",
            margin: "0 0 16px 0",
            lineHeight: 1.4,
          }}
        >
          Limit this style collection to specific channels, archetypes, or
          formats. Leave blank for universal availability.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
          }}
        >
          {/* Channel */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#cdc3d7",
                marginBottom: 8,
              }}
            >
              Channel
            </label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="v2-select"
            >
              <option value="">Any Channel</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>

          {/* Archetype */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#cdc3d7",
                marginBottom: 8,
              }}
            >
              Archetype
            </label>
            <select
              value={archetypeId}
              onChange={(e) => setArchetypeId(e.target.value)}
              className="v2-select"
            >
              <option value="">Any Archetype</option>
              {archetypes.map((arch) => (
                <option key={arch.id} value={arch.id}>
                  {arch.name} ({arch.image_style})
                </option>
              ))}
            </select>
          </div>

          {/* Format */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#cdc3d7",
                marginBottom: 8,
              }}
            >
              Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="v2-select"
            >
              <option value="">Any Format</option>
              {ALL_FORMATS.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </GlassCard>

      {/* Text Guidelines */}
      <GlassCard style={{ padding: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: "0 0 8px 0",
          }}
        >
          Text Guidelines
        </h3>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.6)",
            margin: "0 0 16px 0",
            lineHeight: 1.4,
          }}
        >
          These guidelines are injected verbatim into AI image generation
          prompts for visual consistency.
        </p>

        <textarea
          value={textGuidelines}
          onChange={(e) => setTextGuidelines(e.target.value)}
          placeholder={`Style: Flat 2D illustration, minimal linework
Colors: #2563EB, white, gray
Forbidden: gradients, shadows, 3D effects`}
          rows={6}
          style={{
            width: "100%",
            padding: "12px",
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 6,
            color: "#e5e2e1",
            fontSize: 11,
            fontFamily: "monospace",
            resize: "vertical",
          }}
        />
      </GlassCard>

      {/* Reference Images */}
      <GlassCard style={{ padding: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: "0 0 8px 0",
          }}
        >
          Reference Images *
        </h3>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.6)",
            margin: "0 0 16px 0",
            lineHeight: 1.4,
          }}
        >
          Upload 1-5 reference images that exemplify this style. Claude will
          select the best reference per scene.
        </p>

        {/* Drop Zone */}
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: 32,
            border: `2px dashed ${dragActive ? "var(--v2-accent)" : "rgba(var(--v2-accent-rgb), 0.3)"}`,
            borderRadius: 8,
            background: dragActive
              ? "rgba(var(--v2-accent-rgb), 0.05)"
              : "rgba(0,0,0,0.2)",
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 32,
              color: "var(--v2-accent)",
              marginBottom: 8,
              display: "block",
            }}
          >
            upload_file
          </span>
          <p
            style={{
              fontSize: 12,
              color: "#cdc3d7",
              margin: "0 0 4px 0",
              fontWeight: 600,
            }}
          >
            Drop images here or click to browse
          </p>
          <p
            style={{ fontSize: 10, color: "rgba(205,195,215,0.5)", margin: 0 }}
          >
            PNG, JPG, WEBP • Max 5 images
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          style={{ display: "none" }}
        />

        {/* Uploaded Images Grid */}
        {uploadedImages.length > 0 && (
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            {uploadedImages.map((img, idx) => (
              <div
                key={idx}
                style={{
                  position: "relative",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "rgba(0,0,0,0.3)",
                }}
              >
                <img
                  src={img.preview}
                  alt={`Reference ${idx + 1}`}
                  style={{
                    width: "100%",
                    height: 150,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                <div style={{ padding: 8 }}>
                  <select
                    value={img.ref_type}
                    onChange={(e) => updateRefType(idx, e.target.value)}
                    className="v2-select v2-select-sm"
                  >
                    <option value="style_guide">
                      Style Guide (Single Scene)
                    </option>
                    <option value="style_guides_multi">
                      Style Guides (Multiple Scenes)
                    </option>
                    <option value="logo">Logo</option>
                    <option value="typography">Typography</option>
                    <option value="color_palette">Color Palette</option>
                    <option value="scene_example">Scene Example</option>
                    <option value="real_image_placement_1">
                      Real Image Placement Example
                    </option>
                    <option value="real_image_placement_2">
                      Colored Boxes Placement Reference
                    </option>
                    <option value="character_reference">
                      Character Reference Sheet
                    </option>
                  </select>
                </div>
                <button
                  onClick={() => removeImage(idx)}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    background: "rgba(0,0,0,0.7)",
                    border: "1px solid rgba(248,113,113,0.5)",
                    borderRadius: 4,
                    padding: "4px 8px",
                    cursor: "pointer",
                    color: "#f87171",
                    fontSize: 10,
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button
          onClick={() => router.push("/style-collections")}
          disabled={saving}
          style={{
            padding: "10px 20px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "#cdc3d7",
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.5 : 1,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "10px 20px",
            background: saving
              ? "rgba(var(--v2-accent-rgb), 0.3)"
              : "var(--v2-accent)",
            border: "1px solid var(--v2-accent)",
            borderRadius: 6,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {saving && (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              progress_activity
            </span>
          )}
          {saving
            ? "Saving..."
            : initialData
              ? "Update Collection"
              : "Create Collection"}
        </button>
      </div>
    </div>
  );
}
