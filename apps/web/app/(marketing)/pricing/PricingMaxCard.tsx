"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatUsd, maxPlanCredits, maxSettingsHref } from "@/lib/billing-display";

export default function PricingMaxCard() {
  const [monthly, setMonthly] = useState(100);
  const credits = useMemo(() => maxPlanCredits(monthly), [monthly]);

  return (
    <article className="price-card price-card-max">
      <div className="price-name">Max</div>
      <div className="price-amount">
        <span className="amt">{formatUsd(monthly)}</span>
        <span className="per">/ month</span>
      </div>
      <p className="price-desc">
        A larger model wallet you can size to the work ahead, with a clear edge on Gate 15-funded usage.
      </p>

      <label className="pricing-max-control">
        <span>
          Monthly commitment
          <output htmlFor="pricing-max-range">{formatUsd(monthly)}</output>
        </span>
        <input
          id="pricing-max-range"
          type="range"
          min={100}
          max={200}
          step={10}
          value={monthly}
          onChange={(event) => setMonthly(Number(event.target.value))}
        />
        <span className="pricing-max-ends" aria-hidden="true">
          <span>$100</span>
          <span>$200</span>
        </span>
      </label>

      <div className="price-cta">
        <Link
          href={maxSettingsHref(monthly)}
          className="btn-secondary"
        >
          Choose Max at {formatUsd(monthly)}
        </Link>
      </div>
      <ul className="price-features">
        <li>{formatUsd(credits.usage)} monthly build balance</li>
        <li>{formatUsd(credits.reliability)} retry/correction reserve</li>
        <li>{formatUsd(credits.total)} total monthly model credits</li>
        <li>Included Gate 15 model wallet</li>
        <li>Optional BYOK provider overrides</li>
      </ul>
    </article>
  );
}
