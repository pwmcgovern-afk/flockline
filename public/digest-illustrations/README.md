# Flockline digest illustrations

These images are generic species portraits for the weekly email. They are never evidence of the reported individual, place, or checklist.

## Art direction

The V1 assets were generated with OpenAI's built-in image-generation tool. Each prompt used this shared direction:

> Create a clearly stylized and species-accurate field-guide illustration on warm cream paper. Use visible graphite linework with watercolor and gouache, like a refined vintage natural-history plate. Use a generic, species-appropriate habitat with no identifiable location. Show one full bird in a natural pose in a 3:2 landscape composition. Keep the result visibly illustrated and never photorealistic. This is a generic representative of the species, not a depiction of a reported individual. Include no text, labels, borders, logos, watermark, people, bird bands, GPS pins, app interface, nest, or eggs.

Each species prompt added its scientific name, diagnostic field marks, proportions, plumage, pose, and habitat:

- `brnboo`: Brown Booby (`Sula leucogaster`) on a coastal rock.
- `bbwduc`: Black-bellied Whistling-Duck (`Dendrocygna autumnalis`) at a freshwater marsh.
- `stisan`: Stilt Sandpiper (`Calidris himantopus`) wading in shallow water in late-summer transitional plumage.
- `woosto`: Wood Stork (`Mycteria americana`) standing in a shallow cypress wetland.
- `libher`: Adult Little Blue Heron (`Egretta caerulea`) stalking in a freshwater marsh.
- `sancra`: Sandhill Crane (`Antigone canadensis`) standing in an open marsh meadow.
- `baisan`: Baird's Sandpiper (`Calidris bairdii`) walking along a shoreline in late-summer plumage.
- `wispet`: Wilson's Storm-Petrel (`Oceanites oceanicus`) fluttering low over the open ocean.

The email template adds the visible caption `Flockline species illustration · Not the reported individual.` under every image. Do not add a photographic fallback.

## On-demand generation (since 2026-08-24)

Species without a curated asset no longer stay text-only: `lib/illustrationGeneration.js` generates a plate on first appearance using the same shared direction above (a model writes the species-specific field-mark sentence), rendered by `openai/gpt-image-1` through the Vercel AI Gateway and cached forever in the Blob store at `illustrations/{speciesCode}-v1.jpg`. The Monday `illustration-prewarm` cron (13:30 UTC) fills the cache before the send; the send path carries a small catch-up budget. The eight curated V1 assets above stay canonical for their species. A species that still cannot be resolved falls back to text-only, never to a photo.
