# Core launch cleanup

Guillem requested removal of WhatsApp/SMS, widgets and secondary widget controls, broad wellness reports and additional integrations. Decisions, memory optimization and the consented global sleep pool remain CORE.

Based on coordinated rest release effa30b, with conversational agent 2978203 integrated. Agent labels migration is 036 to avoid colliding with measured-rest 035. Both domain tools preserve rest hypotheses, narrowing preferences, exclusions and measured claims.

The app has an independent adapter for context and durable actions; no webhook or provider sender is imported. Canonical leased prepare/enqueue/commit, replay recovery, receipt validation, privacy, voice, authentication, native blocking and scheduling are retained. Widget target/build phases/assets/deep links/shared timers were removed, together with NFC scanning/relink/reset and the secondary vacation card. The old web preview and Early Access entry were retired; the static landing now leads to the app. Android no longer builds a wellness score or launches wearable OAuth; its report displays recorded sleep. iOS reports include sleep and overnight recovery while explicitly authorized broader Health context remains private model input.

Historical SQL migrations and account deletion identifiers remain for existing data. Removing feature source must not destroy user data or break deletion. Prior deployments, credentials and historical QA receipts are unchanged; they do not certify this candidate. Production publishing must explicitly omit retired functions instead of using the old publisher that preserves every legacy function.

Validation: product harness baseline tmp/product-harness/baseline.json; core launch audit, retained runtime tests and macOS/Android CI. Real iPhone/Watch execution, signing and TestFlight distribution are separate evidence. No production deploy or provider spend is part of this change.
