// Thin wrapper around the queue_* RPCs (see the "DURABLE QUEUE
// ARCHITECTURE" migration). Every producer and worker in this app goes
// through here rather than calling admin.rpc(...) directly, so the
// shape of a queue message — and what "success"/"retry"/"dead letter"
// actually mean — only has to be right in one place.
//
// Always called with the service-role admin client: enqueuing happens
// from SECURITY DEFINER SQL functions (queue_one_off_message,
// emit_payment_created_event) for the interactive path, and this JS
// client is for the worker side, which never has a signed-in session.

export async function enqueue(admin, queueName, instituteId, payload, { delaySeconds = 0 } = {}) {
  const { data, error } = await admin.rpc("queue_enqueue", {
    p_queue_name: queueName,
    p_institute_id: instituteId,
    p_payload: payload,
    p_delay_seconds: delaySeconds,
  });
  if (error) throw new Error(`queue.enqueue(${queueName}): ${error.message}`);
  return data; // msg_id
}

export async function readBatch(admin, queueName, { visibilityTimeout = 30, batchSize = 10, conditional = {} } = {}) {
  const { data, error } = await admin.rpc("queue_read", {
    p_queue_name: queueName,
    p_vt: visibilityTimeout,
    p_qty: batchSize,
    p_conditional: conditional,
  });
  if (error) throw new Error(`queue.read(${queueName}): ${error.message}`);
  return data || [];
}

export async function ack(admin, queueName, msgId, instituteId, detail = null) {
  const { error } = await admin.rpc("queue_ack", {
    p_queue_name: queueName,
    p_msg_id: msgId,
    p_institute_id: instituteId,
    p_detail: detail,
  });
  if (error) throw new Error(`queue.ack(${queueName}, ${msgId}): ${error.message}`);
}

// Transient failure, still under the attempt limit — just logs. The
// message itself is left alone; pgmq's own visibility timeout makes it
// readable again once this worker's lease on it expires. That's the
// retry — nothing here schedules one.
export async function fail(admin, queueName, msgId, instituteId, errorMessage, readCt = null) {
  const { error } = await admin.rpc("queue_fail", {
    p_queue_name: queueName,
    p_msg_id: msgId,
    p_institute_id: instituteId,
    p_error: errorMessage,
    p_read_ct: readCt,
  });
  // Logging the failure must never be the reason a worker run aborts —
  // same "logging is best-effort" reasoning as lib/automation/logger.js.
  if (error) console.error(`[queue] could not log failure for ${queueName}/${msgId}:`, error.message);
}

export async function deadLetter(admin, queueName, msgId, instituteId, payload, errorMessage, readCt = null) {
  const { error } = await admin.rpc("queue_dead_letter", {
    p_queue_name: queueName,
    p_msg_id: msgId,
    p_institute_id: instituteId,
    p_payload: payload,
    p_error: errorMessage,
    p_read_ct: readCt,
  });
  if (error) console.error(`[queue] could not dead-letter ${queueName}/${msgId}:`, error.message);
}

export async function metrics(admin) {
  const { data, error } = await admin.rpc("queue_metrics");
  if (error) throw new Error(`queue.metrics: ${error.message}`);
  return data || [];
}
