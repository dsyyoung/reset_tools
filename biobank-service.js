async function getBiobankDetails(pool, resId) {
  if (!pool) throw new Error('Biobank database unavailable');
  const result = await pool.query({
    text: `SELECT visit_code, collection_date::text AS collection_date,
      sample_type, box_id, box_position, sample_location,
      repeated_position_across_submissions
      FROM public.biobank_tube_observations
      WHERE res_id = $1
      ORDER BY visit_code, collection_date NULLS LAST, sample_type,
        box_id, box_position, response_id, participant_slot
      LIMIT 5001`,
    values: [resId],
  });
  if (result.rows.length > 5000) throw new Error('Biobank result too large');
  return { data: result.rows, meta: { res_id: resId, field: 'biobank_collection', count: result.rows.length } };
}
module.exports = { getBiobankDetails };
