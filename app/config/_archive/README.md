# Archived Configuration Files

These files have been archived because **Supabase is now the single source of truth** for model configuration.

## Why Archived

- `createModels.ts` - Model list, tags, and display names are now in Supabase `models` table

## Do NOT Restore

These files are kept for reference only. All model management should be done via Supabase.

## Where to Add Models Now

See: `docs/.adding-new-model.md`

**Supabase tables:**
1. `models` - UI config
2. `model_configs` - API config
3. `model_pricing` - Pricing
