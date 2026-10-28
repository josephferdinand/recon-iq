import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { usePasswordPeek } from "@/hooks/use-password-peek";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function FixturePasswordPeek() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const currentPeek = usePasswordPeek();
  const nextPeek = usePasswordPeek();
  const confirmPeek = usePasswordPeek();
  const newPeek = usePasswordPeek();
  const confirmResetPeek = usePasswordPeek();

  return (
    <div className="mx-auto max-w-xl space-y-8 p-6">
      <h1 className="font-display text-2xl font-semibold">Fixture: password peek</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Update your password (fixture)
          </CardTitle>
          <CardDescription>Change password screen - 3 peek fields.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-1.5">
              <Label htmlFor="current" className="text-xs uppercase tracking-wider text-muted-foreground">Current password</Label>
              <div className="relative">
                <Input id="current" type={currentPeek.type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11 pr-10" required />
                <button type="button" onClick={currentPeek.toggle} aria-label={currentPeek.visible ? "Hide password" : "Show password"} aria-pressed={currentPeek.visible} className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {currentPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next" className="text-xs uppercase tracking-wider text-muted-foreground">New password</Label>
              <div className="relative">
                <Input id="next" type={nextPeek.type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="h-11 pr-10" required minLength={12} />
                <button type="button" onClick={nextPeek.toggle} aria-label={nextPeek.visible ? "Hide password" : "Show password"} aria-pressed={nextPeek.visible} className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {nextPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-xs uppercase tracking-wider text-muted-foreground">Confirm new password</Label>
              <div className="relative">
                <Input id="confirm" type={confirmPeek.type} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11 pr-10" required minLength={12} />
                <button type="button" onClick={confirmPeek.toggle} aria-label={confirmPeek.visible ? "Hide password" : "Show password"} aria-pressed={confirmPeek.visible} className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {confirmPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="h-11 w-full">Update password</Button>
          </form>
        </CardContent>
      </Card>
      <div className="rounded-2xl border border-[var(--brand-coffee)]/15 bg-[var(--brand-cream-soft)] p-8">
        <div className="flex flex-col items-center text-center">
          <KeyRound className="h-10 w-10 text-primary" />
          <h2 className="mt-3 font-display text-2xl font-semibold">Set a new password (fixture)</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose a strong password (minimum 12 characters).</p>
        </div>
        <form className="mt-6 space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs uppercase tracking-wider text-muted-foreground">New password</Label>
            <div className="relative">
              <Input id="new-password" type={newPeek.type} autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="h-11 pr-10" />
              <button type="button" onClick={newPeek.toggle} aria-label={newPeek.visible ? "Hide password" : "Show password"} aria-pressed={newPeek.visible} className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                {newPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-xs uppercase tracking-wider text-muted-foreground">Confirm password</Label>
            <div className="relative">
              <Input id="confirm-password" type={confirmResetPeek.type} autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="h-11 pr-10" />
              <button type="button" onClick={confirmResetPeek.toggle} aria-label={confirmResetPeek.visible ? "Hide password" : "Show password"} aria-pressed={confirmResetPeek.visible} className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                {confirmResetPeek.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="h-11 w-full">Update password</Button>
        </form>
      </div>
    </div>
  );
}
