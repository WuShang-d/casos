#include <stdint.h>
#include <stdio.h>
#include <time.h>

__attribute__((noinline)) uint32_t work(uint32_t secret) {
  uint32_t value = secret;
  for (uint32_t i = 0; i < 200000; i++) {
    if (secret & 1) value = value * 1664525u + 1013904223u;
    else value = (value ^ i) + 17u;
  }
  return value;
}

int main(int argc, char **argv) {
  (void)argv;
  struct timespec before, after;
  clock_gettime(CLOCK_MONOTONIC, &before);
  volatile uint32_t result = work((uint32_t)argc);
  clock_gettime(CLOCK_MONOTONIC, &after);
  long long ns = (after.tv_sec - before.tv_sec) * 1000000000LL + after.tv_nsec - before.tv_nsec;
  printf("%lld %u\n", ns, result);
  return 0;
}
