import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { palettes, type Palette } from "../../src/domain/preferences";

type Props = {
  open: boolean;
  palette: Palette;
  onOpenChange: (open: boolean) => void;
  onPaletteChange: (palette: Palette) => void;
};

export const paletteDetails: Record<Palette, { name: string; description: string }> = {
  copper: { name: "Paper Copper", description: "Warm paper surfaces with a copper accent. The default." },
  slate: { name: "Slate", description: "Cool grey surfaces with a blue accent and classic green and red diffs." },
};

/** The colours each preview shows, read from the previewed theme's own `--pc-*` tokens. */
const swatches: { token: string; label: string }[] = [
  { token: "bg-canvas", label: "Background" },
  { token: "bg-surface", label: "Surface" },
  { token: "bg-subtle", label: "Subtle surface" },
  { token: "border-default", label: "Border" },
  { token: "fg-default", label: "Text" },
  { token: "fg-muted", label: "Muted text" },
  { token: "accent", label: "Accent" },
  { token: "success", label: "Success" },
  { token: "warning", label: "Warning" },
  { token: "danger", label: "Danger" },
  { token: "diff-add-bg", label: "Added line" },
  { token: "diff-del-bg", label: "Removed line" },
];

const modes = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

function PalettePreview({ palette, mode, label }: { palette: Palette; mode: "light" | "dark"; label: string }) {
  return (
    <span className="palette-preview" data-palette={palette} data-theme={mode} aria-hidden="true">
      <span className="palette-preview-label">{label}</span>
      <span className="palette-preview-diff">
        <span className="palette-preview-line palette-preview-deletion">−&nbsp;return sum;</span>
        <span className="palette-preview-line palette-preview-addition">+&nbsp;return total;</span>
      </span>
      <span className="palette-swatches">
        {swatches.map(({ token, label: swatchLabel }) => (
          <span
            key={token}
            className="palette-swatch"
            title={swatchLabel}
            style={{ background: `var(--pc-${token})` }}
          />
        ))}
      </span>
    </span>
  );
}

export function SettingsDialog({ open, palette, onOpenChange, onPaletteChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog" aria-describedby="settings-description">
          <div className="dialog-heading">
            <div>
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Description id="settings-description">
                Reviewonator remembers these choices for the next review.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close settings">
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="settings-content">
            <fieldset className="palette-options">
              <legend>Colour theme</legend>
              <p className="palette-options-hint">
                Each colour theme has a light and a dark variant. The System, Light, and Dark switch in the header picks one.
              </p>
              {palettes.map((value) => (
                <label key={value} className={`palette-option ${palette === value ? "palette-selected" : ""}`}>
                  <span className="palette-option-heading">
                    <input
                      type="radio"
                      name="palette"
                      checked={palette === value}
                      onChange={() => onPaletteChange(value)}
                    />
                    <span>
                      <strong>{paletteDetails[value].name}</strong>
                      <small>{paletteDetails[value].description}</small>
                    </span>
                  </span>
                  <span className="palette-previews">
                    {modes.map((mode) => (
                      <PalettePreview key={mode.value} palette={value} mode={mode.value} label={mode.label} />
                    ))}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
