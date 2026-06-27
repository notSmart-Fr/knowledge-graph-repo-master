// @ts-nocheck
//
// Chaos Test — Rule 1: Schema Constraints
// Path includes /schemas/ to trigger the path guard.
// The firewall MUST flag unconstrained z.string() and z.number() in exported *Schema variables.

import { z } from "zod";

export const LaxStringSchema = z.object({
  name: z.string(),              // VIOLATION: no .max()
  email: z.string().email(),     // OK: email counts as constraint
});

export const LaxNumberSchema = z.object({
  age: z.number(),               // VIOLATION: no .min() + .max()
  score: z.number().min(0),      // VIOLATION: no .max()
});

// OK: properly constrained
export const StrictSchema = z.object({
  name: z.string().max(200),
  age: z.number().min(0).max(150),
});
