"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Design specimen demo of the interactive primitives: dialogs, sheets, selects, tabs, toasts and tooltips.
 */

import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, RadioGroup } from "@/components/ui/choice";
import { DialogContent, DialogRoot, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Specimen of the interactive primitives (docs/PLAN.md Phase 2, step 3).
 *
 * Each one is shown doing the job it exists for in this shop, rather than as an
 * abstract widget — sorting is a select, the delivery choice is a radio group,
 * the product views are tabs — so the review is of the component in context.
 */
export function OverlaysDemo() {
  const toast = useToast();
  const [sort, setSort] = useState("relevance");

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap gap-3">
          <DialogRoot>
            <DialogTrigger asChild>
              <Button variant="secondary">Remove from cart</Button>
            </DialogTrigger>
            <DialogContent
              title="Remove the arc floor lamp?"
              description="It will leave your cart. You can add it again from the product page."
            >
              <div className="flex justify-end gap-3">
                <Button variant="tertiary">Keep it</Button>
                <Button variant="danger">Remove</Button>
              </div>
            </DialogContent>
          </DialogRoot>

          <DialogRoot>
            <DialogTrigger asChild>
              <Button variant="secondary">Open the Concierge dock</Button>
            </DialogTrigger>
            <SheetContent
              title="Concierge"
              description="A bottom sheet on a phone, a 420px side panel from tablet up."
            >
              <p className="text-slate text-sm">
                The dock arrives in Phase 6. This is the surface it will live on.
              </p>
            </SheetContent>
          </DialogRoot>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              toast({ title: "Added to cart", description: "Arc floor lamp", tone: "success" })
            }
          >
            Show a confirmation
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "That card was declined",
                description: "Try a different card, or check with your bank.",
                tone: "danger",
              })
            }
          >
            Show an error
          </Button>
          <Tooltip content="Only available for products with a 3D model">
            <IconButton label="What does the 3D mark mean?" variant="secondary">
              <span aria-hidden="true" className="text-sm font-medium">?</span>
            </IconButton>
          </Tooltip>
        </div>

        <Select
          label="Sort by"
          value={sort}
          onValueChange={setSort}
          options={[
            { value: "relevance", label: "Most relevant" },
            { value: "price-asc", label: "Price, low to high" },
            { value: "price-desc", label: "Price, high to low" },
            { value: "rating", label: "Best rated" },
          ]}
          className="max-w-xs"
        />
      </div>

      <div className="flex flex-col gap-8">
        <RadioGroup
          legend="Delivery"
          defaultValue="standard"
          options={[
            { value: "standard", label: "Standard, free", hint: "Thursday to Saturday" },
            { value: "express", label: "Express, €9.00", hint: "Tomorrow before 18:00" },
            { value: "pickup", label: "Collect in Athens", hint: "Unavailable for large items", disabled: true },
          ]}
        />

        <div>
          <Checkbox label="Save this address for next time" defaultChecked />
          <Checkbox
            label="Let the Concierge remember my sizes"
            hint="You can see and delete everything it remembers in your account."
          />
        </div>

        <Tabs
          label="Product views"
          items={[
            { value: "photos", label: "Photos", content: <p className="text-slate text-sm">The gallery.</p> },
            { value: "spin", label: "360°", content: <p className="text-slate text-sm">Drag or use the arrow keys to turn it (Phase 3).</p> },
            { value: "model", label: "3D", content: <p className="text-slate text-sm">A model you can orbit (Phase 3).</p> },
            { value: "room", label: "In my room", content: <p className="text-slate text-sm">True-scale placement (Phase 10).</p>, disabled: true },
          ]}
        />
      </div>
    </div>
  );
}
