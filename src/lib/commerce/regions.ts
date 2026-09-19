/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * States, provinces and territories that addresses in the United States, Canada and Australia must name.
 */

/**
 * In three of the countries the shop delivers to, an address is not complete
 * without its state or province: a carrier cannot route "Springfield 62701"
 * without "IL", and the same postcode can exist in two Canadian provinces'
 * ranges only in theory, but a label without the province is refused. These are
 * the official postal abbreviations (USPS, Canada Post, Australia Post), which
 * is also how they are printed on a label. The names are proper nouns and stay
 * in English on the Greek storefront.
 */

export const ADDRESS_REGIONS = {
  US: [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
    ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
    ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
    ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
    ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
    ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
    ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
    ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
    ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
    ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
    ["WY", "Wyoming"],
  ],
  CA: [
    ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
    ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
    ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
  ],
  AU: [
    ["ACT", "Australian Capital Territory"], ["NSW", "New South Wales"], ["NT", "Northern Territory"], ["QLD", "Queensland"],
    ["SA", "South Australia"], ["TAS", "Tasmania"], ["VIC", "Victoria"], ["WA", "Western Australia"],
  ],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;

export type RegionCountry = keyof typeof ADDRESS_REGIONS;

export function needsRegion(country: string): country is RegionCountry {
  return Object.hasOwn(ADDRESS_REGIONS, country);
}

/** The region's code if it belongs to the country, upper-cased; null otherwise. */
export function normaliseRegion(country: RegionCountry, input: string): string | null {
  const code = input.trim().toUpperCase();
  return ADDRESS_REGIONS[country].some(([known]) => known === code) ? code : null;
}
