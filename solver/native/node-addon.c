#include <node_api.h>
#include "solver.h"

typedef struct {
    void *arena;
    unsigned offset[19];
    double number[19];
} Call;

static int unpack(napi_env env, napi_callback_info info, size_t expected, unsigned floating, Call *call) {
    napi_value args[19];
    size_t argc = 19, bytes = 0;
    if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != expected ||
        napi_get_arraybuffer_info(env, args[0], &call->arena, &bytes) != napi_ok || !call->arena) return 0;
    for (size_t i = 1; i < expected; ++i) {
        if (floating & (1u << i)) {
            if (napi_get_value_double(env, args[i], &call->number[i]) != napi_ok) return 0;
        } else if (napi_get_value_uint32(env, args[i], &call->offset[i]) != napi_ok || call->offset[i] > bytes) {
            return 0;
        }
    }
    return call->offset[5] < 2 && call->offset[1] < bytes && call->offset[2] < bytes && call->offset[3] < bytes;
}

static napi_value result(napi_env env, int success) {
    napi_value value;
    if (napi_get_boolean(env, success != 0, &value) != napi_ok) return NULL;
    return value;
}

static napi_value bad_call(napi_env env) {
    napi_throw_type_error(env, NULL, "Invalid TurnRiverLab arena call.");
    return NULL;
}

static napi_value evaluate(napi_env env, napi_callback_info info) {
    Call call;
    if (!unpack(env, info, 15, (1u << 6) | (1u << 14), &call)) return bad_call(env);
    const unsigned *u = call.offset;
    return result(env, evaluate_gto(call.arena, u[1], u[2], u[3], u[4], u[5], call.number[6],
        u[7], u[8], u[9], u[10], u[11], u[12], u[13], call.number[14]));
}

static napi_value train(napi_env env, napi_callback_info info) {
    Call call;
    const unsigned floating = (1u << 6) | (1u << 12) | (1u << 14) | (1u << 15) | (1u << 17);
    if (!unpack(env, info, 19, floating, &call)) return bad_call(env);
    const unsigned *u = call.offset;
    const double *d = call.number;
    return result(env, train_locked(call.arena, u[1], u[2], u[3], u[4], u[5], d[6], u[7], u[8], u[9],
        u[10], u[11], d[12], u[13], d[14], d[15], u[16], d[17], u[18]));
}

NAPI_MODULE_INIT() {
    napi_property_descriptor properties[] = {
        {.utf8name = "evaluate", .method = evaluate},
        {.utf8name = "train", .method = train},
    };
    if (napi_define_properties(env, exports, 2, properties) != napi_ok) return NULL;
    return exports;
}
