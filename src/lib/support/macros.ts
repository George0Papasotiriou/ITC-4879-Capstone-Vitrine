/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The ready answers the desk ships with, in both languages.
 */

import type { Macro } from "@/lib/support/store";

/**
 * Macros (docs/adr/021) are the answers an agent sends often, written once and
 * in both languages. Each one says what happens next, as docs/policies.md
 * requires, and none of them promises anything that file does not.
 *
 * `{name}`, `{number}` (the ticket) and `{order}` are filled in from the
 * ticket. A placeholder with nothing to fill it — `{order}` on a ticket with no
 * order — stays visible, so the agent writes what belongs there instead of
 * sending a gap.
 */
export const DEFAULT_MACROS: readonly Omit<Macro, "id">[] = [
  {
    key: "where_is_my_order",
    topic: "delivery",
    sort: 10,
    titleEn: "Where the order is",
    titleEl: "Πού βρίσκεται η παραγγελία",
    bodyEn:
      "Hello {name},\n\nI have looked at your order. Its state and its history are on the order page, which updates as it moves.\n\nDelivery takes 2–4 working days in Greece and 5–9 in the rest of the EU, from the day it is dispatched. I will write again as soon as it is handed to the carrier.",
    bodyEl:
      "Γεια σου {name},\n\nΚοίταξα την παραγγελία σου. Η κατάστασή της και το ιστορικό της είναι στη σελίδα της παραγγελίας, που ενημερώνεται καθώς προχωράει.\n\nΗ παράδοση θέλει 2–4 εργάσιμες στην Ελλάδα και 5–9 στην υπόλοιπη ΕΕ, από την ημέρα της αποστολής. Θα σου γράψω μόλις παραδοθεί στον μεταφορέα.",
  },
  {
    key: "return_how",
    topic: "returns",
    sort: 20,
    titleEn: "How a return works",
    titleEl: "Πώς γίνεται μια επιστροφή",
    bodyEn:
      "Hello {name},\n\nYou can ask for a return within 14 days of delivery, from the order page: choose the reason and we take it from there. The piece comes back as it arrived, with whatever came with it.\n\nWe will tell you the cost of collection before anything is collected, and the refund goes back to the original payment as soon as the return reaches us.",
    bodyEl:
      "Γεια σου {name},\n\nΜπορείς να ζητήσεις επιστροφή μέσα σε 14 ημέρες από την παράδοση, από τη σελίδα της παραγγελίας: διάλεξε τον λόγο και αναλαμβάνουμε εμείς. Το κομμάτι επιστρέφει όπως ήρθε, με ό,τι το συνόδευε.\n\nΘα σου πούμε το κόστος της παραλαβής πριν παραλάβουμε οτιδήποτε, και η επιστροφή των χρημάτων γίνεται στον ίδιο τρόπο πληρωμής μόλις φτάσει σε εμάς.",
  },
  {
    key: "damaged",
    topic: "returns",
    sort: 21,
    titleEn: "It arrived damaged",
    titleEl: "Ήρθε χτυπημένο",
    bodyEn:
      "Hello {name},\n\nI am sorry — that is not how it should arrive. We will collect it at our cost and refund it in full; you do not need to do anything else.\n\nIf you can send a photograph of the damage it helps us with the carrier, but it is not a condition of the refund.",
    bodyEl:
      "Γεια σου {name},\n\nΛυπάμαι — δεν έπρεπε να φτάσει έτσι. Θα το παραλάβουμε με δικό μας κόστος και θα σου επιστρέψουμε όλο το ποσό· δεν χρειάζεται να κάνεις τίποτε άλλο.\n\nΑν μπορείς να στείλεις μια φωτογραφία της ζημιάς μάς βοηθά με τον μεταφορέα, αλλά δεν είναι προϋπόθεση για την επιστροφή των χρημάτων.",
  },
  {
    key: "vat_export",
    topic: "payment",
    sort: 30,
    titleEn: "Tax on a delivery outside the EU",
    titleEl: "Φόρος σε παράδοση εκτός ΕΕ",
    bodyEn:
      "Hello {name},\n\nFor a delivery outside the EU the order carries no Greek VAT, which is why the total changed when you entered the address.\n\nImport tax and duty are paid on delivery, to the carrier or customs, and are not part of what we charge. The United Kingdom is the exception: we collect UK VAT on orders up to about €160.",
    bodyEl:
      "Γεια σου {name},\n\nΓια παράδοση εκτός ΕΕ η παραγγελία δεν έχει ελληνικό ΦΠΑ, γι' αυτό άλλαξε το σύνολο όταν έβαλες τη διεύθυνση.\n\nΟ φόρος εισαγωγής και οι δασμοί πληρώνονται κατά την παράδοση, στον μεταφορέα ή στο τελωνείο, και δεν είναι μέρος αυτού που χρεώνουμε. Εξαίρεση το Ηνωμένο Βασίλειο: εκεί εισπράττουμε τον βρετανικό ΦΠΑ για παραγγελίες έως περίπου 160 €.",
  },
  {
    key: "student_project",
    topic: "other",
    sort: 40,
    titleEn: "This is a student project",
    titleEl: "Αυτό είναι φοιτητική εργασία",
    bodyEn:
      "Hello {name},\n\nThank you for writing. Vitrine is a student project for a university course: the shop works end to end, but the payment is a test payment, nothing is charged and nothing is dispatched.\n\nIf you were expecting a real order, nothing has been taken from you. Ask me anything about how it works — that part is real.",
    bodyEl:
      "Γεια σου {name},\n\nΕυχαριστούμε που έγραψες. Το Vitrine είναι φοιτητική εργασία για πανεπιστημιακό μάθημα: το κατάστημα λειτουργεί από άκρη σε άκρη, αλλά η πληρωμή είναι δοκιμαστική, δεν χρεώνεται τίποτα και δεν αποστέλλεται τίποτα.\n\nΑν περίμενες πραγματική παραγγελία, δεν σου έχει χρεωθεί τίποτα. Ρώτα με ό,τι θες για το πώς δουλεύει — αυτό το κομμάτι είναι αληθινό.",
  },
  {
    key: "handed_over",
    topic: "other",
    sort: 50,
    titleEn: "Passing it to a person",
    titleEl: "Το δίνω σε άνθρωπο",
    bodyEn:
      "Hello {name},\n\nThank you — I would rather a person answered this than guess. I have passed your ticket {number} to the desk and someone will reply within one working day.",
    bodyEl:
      "Γεια σου {name},\n\nΕυχαριστώ — προτιμώ να σου απαντήσει άνθρωπος παρά να μαντέψω. Έδωσα το αίτημά σου {number} στην ομάδα και κάποιος θα απαντήσει μέσα σε μία εργάσιμη ημέρα.",
  },
];
