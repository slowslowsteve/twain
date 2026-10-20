#ifndef TWAIN_CORE_H
#define TWAIN_CORE_H
#include "mark_core.h"
typedef struct twain twain_t;
twain_t *twain_create(const host_api_v1_t *, const char *);
void twain_destroy(twain_t *);
void twain_process(twain_t *, const int16_t *, int16_t *, int);
void twain_set_param(twain_t *, const char *, const char *);
int twain_get_param(twain_t *, const char *, char *, int);
void twain_on_midi(twain_t *, const uint8_t *, int, int);
#endif
