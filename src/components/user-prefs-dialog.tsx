import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Palette } from "lucide-react";
import { useUserPrefs, resetAllTours } from "@/lib/user-prefs";
import { supportedLocales } from "@/lib/i18n";
import { ThemePicker } from "@/components/theme-picker";
import { toast } from "sonner";


export function UserPrefsDialog() {
  const [open, setOpen] = useState(false);
  const [prefs, update] = useUserPrefs();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Themes" title="Themes" className="gap-1.5 text-foreground">
          <Palette className="h-4 w-4" />
          <span className="text-xs font-medium">Themes</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>Personal settings. Stored locally on this device.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {/* Owner-approved theme catalogue: four canvas palettes, four navigation chromes,
              and explicit light/dark appearance modes. */}
          <ThemePicker />
          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={prefs.locale} onValueChange={(v) => update({ locale: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {supportedLocales.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Density</Label>
            <Select value={prefs.density} onValueChange={(v) => update({ density: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comfortable">Comfortable</SelectItem>
                <SelectItem value="compact">Compact</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Email digest of pending exceptions</Label>
            <Select value={prefs.emailDigest} onValueChange={(v) => update({ emailDigest: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Requires email infrastructure to be enabled by your platform admin.</p>
          </div>
          <div className="space-y-2">
            <Label>Guided tours</Label>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">
                {Object.keys(prefs.tourSeen).length} seen · {Object.keys(prefs.tourProgress).length} in progress
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetAllTours();
                  toast.success("Guided tours reset. They will replay on next visit.");
                }}
              >
                Reset all tours
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Replays the auto-tour on every section and clears resume points.</p>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
