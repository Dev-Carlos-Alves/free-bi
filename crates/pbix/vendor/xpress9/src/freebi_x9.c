// Wrapper mínimo do decodificador XPress9 para o Free BI.
#include <stdlib.h>
#include "xpress.h"
#include "xpress9.h"

static void* XPRESS_CALL fb_alloc(void *ctx, int size) { (void)ctx; return malloc(size); }
static void XPRESS_CALL fb_free(void *ctx, void *p) { (void)ctx; free(p); }

void* freebi_x9_new(void) {
    XPRESS9_STATUS st = {0};
    XPRESS9_DECODER d = Xpress9DecoderCreate(&st, NULL, fb_alloc, XPRESS9_WINDOW_SIZE_LOG2_MAX, 0);
    if (d == NULL || st.m_uStatus != Xpress9Status_OK) return NULL;
    Xpress9DecoderStartSession(&st, d, 1);
    if (st.m_uStatus != Xpress9Status_OK) { Xpress9DecoderDestroy(&st, d, NULL, fb_free); return NULL; }
    return d;
}

void freebi_x9_free(void* d) {
    XPRESS9_STATUS st = {0};
    if (d) Xpress9DecoderDestroy(&st, (XPRESS9_DECODER)d, NULL, fb_free);
}

// Retorna bytes escritos, ou -1 em erro.
long long freebi_x9_decompress(void* dec, unsigned char* in, int in_len, unsigned char* out, int out_cap) {
    XPRESS9_STATUS st = {0};
    XPRESS9_DECODER d = (XPRESS9_DECODER)dec;
    Xpress9DecoderAttach(&st, d, in, in_len);
    if (st.m_uStatus != Xpress9Status_OK) return -1;
    long long total = 0;
    unsigned remaining;
    do {
        unsigned written = 0, consumed = 0;
        remaining = Xpress9DecoderFetchDecompressedData(&st, d, out + total, out_cap - (int)total, &written, &consumed);
        if (st.m_uStatus != Xpress9Status_OK) { total = -1; break; }
        if (written == 0) break;
        total += written;
    } while (remaining != 0);
    Xpress9DecoderDetach(&st, d, in, in_len);
    return total;
}
