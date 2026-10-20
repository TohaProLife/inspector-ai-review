FROM node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50
RUN apk add --no-cache poppler-utils=25.12.0-r1 font-liberation=2.1.5-r2 \
    && test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0" \
    && test "$(pdfinfo -v 2>&1 | head -n 1)" = "pdfinfo version 25.12.0" \
    && test -n "$(fc-match -f '%{file}' TimesNewRomanPSMT)"
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY migrations migrations
COPY packages/contracts packages/contracts
COPY services/worker/rules/matrix-execution-v1.json services/worker/rules/matrix-execution-v1.json
COPY services/worker/rules/parameter_catalog_132.jsonl services/worker/rules/parameter_catalog_132.jsonl
COPY services/worker/rules/matrix-inventory-capabilities-v1.json services/worker/rules/matrix-inventory-capabilities-v1.json
COPY services/worker/rules/matrix-call-inventory-capabilities-v1.json services/worker/rules/matrix-call-inventory-capabilities-v1.json
COPY services/worker/rules/matrix-rail-inventory-capabilities-v1.json services/worker/rules/matrix-rail-inventory-capabilities-v1.json
COPY services/worker/rules/public-source-id-map-v1.json services/worker/rules/public-source-id-map-v1.json
COPY services/worker/inspector_worker/matrix_engine.py services/worker/inspector_worker/matrix_engine.py
COPY services/worker/inspector_worker/matrix_scalar_prepared_v12.py services/worker/inspector_worker/matrix_scalar_prepared_v12.py
COPY services/worker/inspector_worker/matrix_fact_scope.py services/worker/inspector_worker/matrix_fact_scope.py
COPY services/worker/inspector_worker/project_constraints.py services/worker/inspector_worker/project_constraints.py
COPY services/worker/inspector_worker/source_declarations.py services/worker/inspector_worker/source_declarations.py
COPY services/worker/inspector_worker/steel_prose.py services/worker/inspector_worker/steel_prose.py
COPY services/worker/inspector_worker/source_declarations_v2.py services/worker/inspector_worker/source_declarations_v2.py
COPY services/worker/inspector_worker/fire_resistance_table.py services/worker/inspector_worker/fire_resistance_table.py
COPY services/worker/inspector_worker/table_row_binding.py services/worker/inspector_worker/table_row_binding.py
COPY services/worker/inspector_worker/project_zero_prose.py services/worker/inspector_worker/project_zero_prose.py
COPY services/worker/inspector_worker/rebar_prose.py services/worker/inspector_worker/rebar_prose.py
COPY services/worker/inspector_worker/concrete_prose.py services/worker/inspector_worker/concrete_prose.py
COPY services/worker/inspector_worker/inventory_source.py services/worker/inspector_worker/inventory_source.py
COPY services/worker/inspector_worker/ar053_inventory_comparison.py services/worker/inspector_worker/ar053_inventory_comparison.py
COPY services/worker/inspector_worker/inventory_execution.py services/worker/inspector_worker/inventory_execution.py
COPY services/worker/inspector_worker/durable_inventory_matrix.py services/worker/inspector_worker/durable_inventory_matrix.py
COPY services/worker/inspector_worker/call_inventory_source.py services/worker/inspector_worker/call_inventory_source.py
COPY services/worker/inspector_worker/odi123_call_inventory_comparison.py services/worker/inspector_worker/odi123_call_inventory_comparison.py
COPY services/worker/inspector_worker/call_inventory_execution.py services/worker/inspector_worker/call_inventory_execution.py
COPY services/worker/inspector_worker/durable_call_inventory_matrix.py services/worker/inspector_worker/durable_call_inventory_matrix.py
COPY services/worker/inspector_worker/rail_inventory_source.py services/worker/inspector_worker/rail_inventory_source.py
COPY services/worker/inspector_worker/rail_inventory_comparison.py services/worker/inspector_worker/rail_inventory_comparison.py
COPY services/worker/inspector_worker/rail_inventory_execution.py services/worker/inspector_worker/rail_inventory_execution.py
COPY services/worker/inspector_worker/durable_rail_inventory_matrix.py services/worker/inspector_worker/durable_rail_inventory_matrix.py
COPY services/worker/rules/matrix-water-node-capabilities-v1.json services/worker/rules/matrix-water-node-capabilities-v1.json
COPY services/worker/inspector_worker/water_node_source.py services/worker/inspector_worker/water_node_source.py
COPY services/worker/inspector_worker/water_node_comparison.py services/worker/inspector_worker/water_node_comparison.py
COPY services/worker/inspector_worker/water_node_execution.py services/worker/inspector_worker/water_node_execution.py
COPY services/worker/inspector_worker/durable_water_node_matrix.py services/worker/inspector_worker/durable_water_node_matrix.py
COPY services/worker/rules/matrix-lighting-technology-capabilities-v1.json services/worker/rules/matrix-lighting-technology-capabilities-v1.json
COPY services/worker/inspector_worker/lighting_technology_source_v3.py services/worker/inspector_worker/lighting_technology_source_v3.py
COPY services/worker/inspector_worker/lighting_technology_comparison.py services/worker/inspector_worker/lighting_technology_comparison.py
COPY services/worker/inspector_worker/lighting_technology_execution.py services/worker/inspector_worker/lighting_technology_execution.py
COPY services/worker/inspector_worker/durable_lighting_technology_matrix.py services/worker/inspector_worker/durable_lighting_technology_matrix.py
COPY services/worker/rules/matrix-steel-comparison-capabilities-v1.json services/worker/rules/matrix-steel-comparison-capabilities-v1.json
COPY services/worker/inspector_worker/steel_comparison.py services/worker/inspector_worker/steel_comparison.py
COPY services/worker/inspector_worker/steel_execution.py services/worker/inspector_worker/steel_execution.py
COPY services/worker/inspector_worker/durable_steel_comparison_matrix.py services/worker/inspector_worker/durable_steel_comparison_matrix.py
COPY services/worker/inspector_worker/durable_steel_comparison_matrix_v11.py services/worker/inspector_worker/durable_steel_comparison_matrix_v11.py
COPY services/worker/inspector_worker/text_layer.py services/worker/inspector_worker/text_layer.py
COPY services/worker/inspector_worker/document_text_v3.py services/worker/inspector_worker/document_text_v3.py
COPY services/worker/inspector_worker/durable_text_v3.py services/worker/inspector_worker/durable_text_v3.py
COPY services/worker/inspector_worker/durable_text_v3_cache.py services/worker/inspector_worker/durable_text_v3_cache.py
COPY services/worker/inspector_worker/durable_text_v3_large.py services/worker/inspector_worker/durable_text_v3_large.py
COPY services/worker/inspector_worker/durable_text_v3_large_cache.py services/worker/inspector_worker/durable_text_v3_large_cache.py
COPY services/worker/inspector_worker/document_text_v4.py services/worker/inspector_worker/document_text_v4.py
COPY services/worker/inspector_worker/durable_text_v4_full.py services/worker/inspector_worker/durable_text_v4_full.py
COPY services/worker/inspector_worker/durable_text_v4_full_cache.py services/worker/inspector_worker/durable_text_v4_full_cache.py
COPY services/worker/rules/matrix-column-pylon-section-capabilities-v1.json services/worker/rules/matrix-column-pylon-section-capabilities-v1.json
COPY services/worker/inspector_worker/column_pylon_section_v2.py services/worker/inspector_worker/column_pylon_section_v2.py
COPY services/worker/inspector_worker/column_pylon_dimension_literals.py services/worker/inspector_worker/column_pylon_dimension_literals.py
COPY services/worker/inspector_worker/column_pylon_section_execution.py services/worker/inspector_worker/column_pylon_section_execution.py
COPY services/worker/inspector_worker/column_pylon_section_run_snapshot.py services/worker/inspector_worker/column_pylon_section_run_snapshot.py
COPY services/worker/inspector_worker/durable_column_pylon_section_matrix_v12.py services/worker/inspector_worker/durable_column_pylon_section_matrix_v12.py
COPY services/worker/inspector_worker/concrete_wall_native_v13.py services/worker/inspector_worker/concrete_wall_native_v13.py
COPY services/worker/inspector_worker/concrete_wall_prose_v1.py services/worker/inspector_worker/concrete_wall_prose_v1.py
COPY services/worker/inspector_worker/concrete_wall_scope_v1.py services/worker/inspector_worker/concrete_wall_scope_v1.py
COPY services/worker/inspector_worker/concrete_wall_transport_v13.py services/worker/inspector_worker/concrete_wall_transport_v13.py
COPY services/worker/inspector_worker/concrete_wall_execution_v13.py services/worker/inspector_worker/concrete_wall_execution_v13.py
COPY services/worker/inspector_worker/durable_concrete_wall_matrix_v13.py services/worker/inspector_worker/durable_concrete_wall_matrix_v13.py
COPY services/worker/inspector_worker/concrete_wall_fact_scope_v13.py services/worker/inspector_worker/concrete_wall_fact_scope_v13.py
COPY services/worker/inspector_worker/concrete_wall_matrix_engine_v13.py services/worker/inspector_worker/concrete_wall_matrix_engine_v13.py
COPY services/worker/inspector_worker/matrix-policy-history-v3.json services/worker/inspector_worker/matrix-policy-history-v3.json
COPY apps/api apps/api
# Fail the build if runtime packages/fonts or Cyrillic report export are incomplete.
RUN node --import tsx apps/api/scripts/check-installed-exports.ts
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "@inspector-ai/api"]
