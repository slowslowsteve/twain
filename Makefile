CC ?= cc
CFLAGS = -O2 -g -Wall -Wextra -Iinclude
TEST_FX_DIR = build/test-modules/audio_fx/testfx

ifeq ($(shell uname -s),Darwin)
SHARED_FLAGS = -dynamiclib
else
SHARED_FLAGS = -shared
endif

.PHONY: test test-ui arm clean

test: build/host_sim build/twain_sim build/twain_projects_sim test-ui
	./build/host_sim
	./build/twain_sim
	./build/twain_projects_sim

build/host_sim: src/mark_core.c src/mark_core.h test/host_sim.c $(TEST_FX_DIR)/testfx.so
	@mkdir -p build
	$(CC) $(CFLAGS) src/mark_core.c test/host_sim.c -o $@ -lm -lpthread

$(TEST_FX_DIR)/testfx.so: test/fake_fx.c test/fake_fx_module.json include/audio_fx_api_v2.h
	@mkdir -p $(TEST_FX_DIR) build/test-modules/overtake/mark
	$(CC) $(CFLAGS) -fPIC $(SHARED_FLAGS) test/fake_fx.c -o $@
	cp test/fake_fx_module.json $(TEST_FX_DIR)/module.json

arm:
	./scripts/build.sh

clean:
	rm -rf build

test-ui:
	node --no-warnings --experimental-vm-modules test/ui_overtake.mjs
	node --no-warnings --experimental-vm-modules test/ui_twain.mjs
	node test/twain_project_identity.mjs
	node test/twain_projects.mjs
	node --no-warnings --experimental-vm-modules test/ui_twain_projects.mjs
	python3 -B test/twain_project_probe.py

TWAIN_FLAGS = -DMARK_TRACKS=8 -DMARK_REQUIRE_FULL_CAPACITY -DMARK_TWAIN
build/twain_sim: src/mark_core.c src/twain_core.c src/twain_core.h src/twain_project_io.h src/twain_project_io.inc src/mark_core.h src/twain_fx.h test/twain_sim.c
	@mkdir -p build
	$(CC) $(CFLAGS) $(TWAIN_FLAGS) src/mark_core.c src/twain_core.c test/twain_sim.c -o $@ -lm -lpthread

.PHONY: twain twain-arm twain-sanitize
twain: build/modules/overtake/twain/dsp.so
build/modules/overtake/twain/dsp.so: src/mark_core.c src/twain_core.c src/twain_gen.c src/ui_twain.js src/twain_projects.mjs src/twain_project_identity.mjs src/twain_project_io.h src/twain_project_io.inc src/twain_fx.h src/mark_core.h modules/overtake/twain/module.json
	@mkdir -p build/modules/overtake/twain
	$(CC) $(CFLAGS) $(TWAIN_FLAGS) -fPIC $(SHARED_FLAGS) src/mark_core.c src/twain_core.c src/twain_gen.c -o $@ -lm -lpthread
	cp src/ui_twain.js build/modules/overtake/twain/ui.js
	cp src/twain_projects.mjs src/twain_project_identity.mjs build/modules/overtake/twain/
	cp modules/overtake/twain/module.json build/modules/overtake/twain/module.json
twain-arm:
	bash scripts/build-twain.sh
twain-sanitize:
	$(CC) $(CFLAGS) $(TWAIN_FLAGS) -fsanitize=address,undefined -fno-omit-frame-pointer src/mark_core.c src/twain_core.c test/twain_sim.c -o build/twain_sanitize -lm -lpthread
	./build/twain_sanitize
	$(CC) $(CFLAGS) $(TWAIN_FLAGS) -fsanitize=address,undefined -fno-omit-frame-pointer src/mark_core.c src/twain_core.c test/twain_projects_sim.c -o build/twain_projects_sanitize -lm -lpthread
	./build/twain_projects_sanitize

build/twain_projects_sim: src/mark_core.c src/mark_core.h src/twain_core.c src/twain_core.h src/twain_project_io.h src/twain_project_io.inc src/twain_fx.h test/twain_projects_sim.c
	@mkdir -p build
	$(CC) $(CFLAGS) $(TWAIN_FLAGS) src/mark_core.c src/twain_core.c test/twain_projects_sim.c -o $@ -lm -lpthread
