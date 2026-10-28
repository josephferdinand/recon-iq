import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Check, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StripeEmbeddedCheckout } from '@/components/StripeEmbeddedCheckout';
import { PaymentTestModeBanner } from '@/components/PaymentTestModeBanner';
import { supabase } from '@/integrations/supabase/client';
import { getStripeEnvironment } from '@/lib/stripe';
import { createPortalSession, changePlan } from '@/lib/payments.functions';
import { toast } from 'sonner';

type Cycle = 'monthly' | 'yearly';

const PLANS = [
  {
    id: 'starter', name: 'ReconIQ Starter', tagline: 'For growing finance teams',
    monthly: { id: 'fvi_starter_monthly', price: 999 },
    yearly:  { id: 'fvi_starter_yearly',  price: 10000 },
    features: [
      'Up to 3 reconciliations',
      '10 users',
      '5M records / month',
      'Cash & bank / Nostro rekon',
      'AI auto-mapping',
      '20+ deterministic matching rules',
      'Email support',
    ],
  },
  {
    id: 'professional', name: 'ReconIQ Professional', tagline: 'Most popular',
    highlight: true,
    monthly: { id: 'fvi_professional_monthly', price: 2499 },
    yearly:  { id: 'fvi_professional_yearly',  price: 25000 },
    features: [
      'Unlimited reconciliations',
      '50 users',
      '50M records / month',
      'All Starter features',
      'Securities & trades + Intercompany/GL',
      'BYO-LLM (Anthropic, Muse, Bedrock)',
      'SSO (SAML / OIDC)',
      'Scheduled connectors (SFTP/S3/HTTP)',
      'Real-time presence & collaboration',
      '24/5 priority support',
    ],
  },
  {
    id: 'enterprise', name: 'ReconIQ Enterprise', tagline: 'For global banks',
    monthly: { id: 'fvi_enterprise_monthly', price: 9999 },
    yearly:  { id: 'fvi_enterprise_yearly',  price: 100000 },
    features: [
      'Unlimited everything',
      'Dedicated infrastructure (silo)',
      'Data residency pinning',
      'SOC 2 + ISO 27001 + GDPR pack',
      'Custom matching rules',
      'Hash-chained immutable audit',
      '24/7 SLA support + named CSM',
    ],
  },
];

export const Route = createFileRoute('/_authenticated/billing')({
  component: BillingPage,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error instanceof Error ? error.message : "An unexpected error occurred."}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function BillingPage() {
  const [cycle, setCycle] = useState<Cycle>('yearly');
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ price_id: string; status: string; current_period_end: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      try {
        const env = getStripeEnvironment();
        const { data } = await supabase.from('subscriptions').select('price_id, status, current_period_end')
          .eq('user_id', user.id).eq('environment', env)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        setCurrent(data as any);
      } catch { /* token not configured */ }
      setLoading(false);
    })();
  }, []);

  const openPortal = async () => {
    try {
      const result = await createPortalSession({ data: { environment: getStripeEnvironment(), returnUrl: window.location.href } });
      if ('error' in result) throw new Error(result.error);
      window.open(result.url, '_blank');
    } catch (e: any) { toast.error(e.message); }
  };

  const doChangePlan = async (priceId: string) => {
    try {
      const result = await changePlan({ data: { newPriceId: priceId, environment: getStripeEnvironment() } });
      if ('error' in result) throw new Error(result.error);
      toast.success(result.proration_invoiced ? 'Upgraded — proration invoiced now.' : 'Downgrade scheduled for next billing cycle.');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) { toast.error(e.message); }
  };

  if (selected) {
    return (
      <div className="min-h-screen bg-background">
        <PaymentTestModeBanner />
        <div className="max-w-3xl mx-auto p-6">
          <Button variant="ghost" onClick={() => setSelected(null)} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to plans
          </Button>
          <h1 className="text-2xl font-semibold mb-4">Complete your subscription</h1>
          <StripeEmbeddedCheckout
            priceId={selected}
            returnUrl={`${window.location.origin}/billing?success=1&session_id={CHECKOUT_SESSION_ID}`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PaymentTestModeBanner />
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-2">
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 inline mr-1" /> Home
          </Link>
          {current && (
            <Button variant="outline" onClick={openPortal}>Manage billing</Button>
          )}
        </div>
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-2">Plans built for reconciliation at scale</h1>
          <p className="text-muted-foreground">Outperform incumbent platforms. Start with what fits today, upgrade as you grow.</p>
          {current && !loading && (
            <Badge variant="secondary" className="mt-4">
              Current plan: {current.price_id} · {current.status}
            </Badge>
          )}
        </div>

        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-muted rounded-lg p-1">
            <button onClick={() => setCycle('monthly')}
              className={`px-4 py-2 rounded-md text-sm font-medium ${cycle === 'monthly' ? 'bg-background shadow' : ''}`}>
              Monthly
            </button>
            <button onClick={() => setCycle('yearly')}
              className={`px-4 py-2 rounded-md text-sm font-medium ${cycle === 'yearly' ? 'bg-background shadow' : ''}`}>
              Annual <Badge variant="secondary" className="ml-2">Save ~17%</Badge>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map(plan => {
            const p = cycle === 'monthly' ? plan.monthly : plan.yearly;
            const isCurrent = current?.price_id === p.id;
            const canChange = current && !isCurrent && current.status === 'active';
            return (
              <Card key={plan.id} className={`p-6 flex flex-col ${plan.highlight ? 'border-primary border-2 shadow-lg' : ''}`}>
                {plan.highlight && <Badge className="self-start mb-2">Most popular</Badge>}
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">{plan.tagline}</p>
                <div className="mb-6">
                  <span className="text-4xl font-bold">${p.price.toLocaleString()}</span>
                  <span className="text-muted-foreground">/{cycle === 'monthly' ? 'mo' : 'yr'}</span>
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <Button disabled variant="outline">Current plan</Button>
                ) : canChange ? (
                  <Button onClick={() => doChangePlan(p.id)} variant={plan.highlight ? 'default' : 'outline'}>
                    Switch to this plan
                  </Button>
                ) : (
                  <Button onClick={() => setSelected(p.id)} variant={plan.highlight ? 'default' : 'outline'}>
                    Subscribe
                  </Button>
                )}
              </Card>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Upgrades are prorated and invoiced immediately. Downgrades take effect at the next billing cycle. Cancellations keep access until period end.
        </p>
      </div>
    </div>
  );
}
