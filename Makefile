.PHONY: help install pods start run build app-logs typecheck lint test swift-check swift-test battery-probe app-icon widget-snapshots demo verify clean commit push \
	dist release unrelease app-install doctor hook-report \
	desktop-install desktop-build desktop-start desktop-typecheck desktop-dist android-apk android-widget-preview \
	check-app-duplicate-blocks check-app-macos-project check-app-native-boundary check-code-layout check-makefiles \
	check-omp-hooks check-omp-probes check-omp-rules check-omp-skills check-omp-types check-readme check-release check-tooling check-verify

APP := app
MACOS := $(APP)/macos
DESKTOP := $(APP)/desktop
SCHEME := Juice-macOS
WORKSPACE := $(MACOS)/Juice.xcworkspace
# Every macOS build — Debug here, Release in app-release.ts, Xcode's own through
# the workspace's WorkspaceSettings.xcsettings — lands in this one directory. Xcode's
# default DerivedData is keyed by the repository's path, so each move or clone
# left another Juice.app that Spotlight, Launchpad and the widget gallery list
# beside the installed one; `.noindex` keeps Spotlight out of this one too
# (rule://app-macos-project).
APP_NAME := Juice
DERIVED_DATA := $(MACOS)/build/DerivedData.noindex
BUILT_APP := $(DERIVED_DATA)/Build/Products/Debug/$(APP_NAME).app
LSREGISTER := /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Swift sources that compile without React or CocoaPods. `swift-check` type-checks
# them against the active SDK, which the Command Line Tools carry — so the battery
# engine and the widget are gated even on a machine where `build` cannot run.
SWIFT_TARGET := arm64-apple-macos14.0
SDK = $(shell xcrun --show-sdk-path)
SHARED_SWIFT := $(wildcard $(MACOS)/Shared/*.swift)
CORE_SWIFT := $(wildcard $(MACOS)/Juice-macOS/Native/Core/*.swift)
WIDGET_SWIFT := $(wildcard $(MACOS)/JuiceWidget/*.swift)
# Active developer directory; `swift-test` finds Swift Testing's plugin and framework under it.
DEVELOPER_PATH = $(shell xcode-select -p)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install JS dependencies (npm ci), then CocoaPods
	cd $(APP) && npm ci
	$(MAKE) pods

pods: ## Install CocoaPods for the macOS app (requires Xcode)
	cd $(MACOS) && pod install

start: ## Start the Metro bundler
	cd $(APP) && npx react-native start

build: ## Build the macOS app and widget extension, Debug, into app/macos/build/DerivedData.noindex (requires Xcode)
	xcodebuild -workspace $(WORKSPACE) -scheme $(SCHEME) -configuration Debug -derivedDataPath $(DERIVED_DATA) build

# A menu bar app keeps running, so a fresh build is not what runs until the old
# process quits; the widget host caches the extension until it is re-registered,
# and prefers a copy with a higher version (a Release `make dist` left) over this
# build — so every other registered copy is unregistered by absolute path, leaving
# /Applications and this build. Debug loads its JS from Metro, so the minutes of
# the Xcode build wait on Metro answering: an empty window is the symptom of its absence.
run: ## Build, quit the running app, unregister every other copy, re-register the widget and launch the build (requires Xcode; Debug needs `make start`)
	node .omp/hooks/lib/app-doctor.ts metro
	$(MAKE) build
	-pkill -x $(APP_NAME)
	node .omp/hooks/lib/app-launch-services.ts unregister-others "$(abspath $(BUILT_APP))"
	pluginkit -a "$(BUILT_APP)/Contents/PlugIns/JuiceWidget.appex"
	open "$(BUILT_APP)"
	-killall chronod

app-logs: ## Stream the log lines of the running app and its widget extension
	log stream --style compact --info --predicate 'process == "$(APP_NAME)" OR process == "$(APP_NAME)Widget"'

typecheck: ## Type-check TypeScript (tsc)
	cd $(APP) && npx tsc --noEmit

lint: ## Lint TypeScript (eslint)
	cd $(APP) && npx eslint .

test: ## Run JS tests (jest)
	cd $(APP) && npx jest

swift-check: ## Type-check the React-free Swift sources: shared snapshot, battery engine, widget
	swiftc -typecheck -sdk "$(SDK)" -target $(SWIFT_TARGET) $(SHARED_SWIFT) $(CORE_SWIFT)
	swiftc -typecheck -parse-as-library -sdk "$(SDK)" -target $(SWIFT_TARGET) $(SHARED_SWIFT) $(WIDGET_SWIFT)

# The Command Line Tools ship Swift Testing but SwiftPM does not find its macro
# plugin or framework there on its own (it does under Xcode); point at both.
swift-test: ## Run the Swift Testing suite over the React-free Swift (SwiftPM, no Xcode)
	swift test --package-path $(MACOS)/CoreTests \
		-Xswiftc -plugin-path -Xswiftc "$(DEVELOPER_PATH)/usr/lib/swift/host/plugins/testing" \
		-Xswiftc -F -Xswiftc "$(DEVELOPER_PATH)/Library/Developer/Frameworks" \
		-Xlinker -rpath -Xlinker "$(DEVELOPER_PATH)/Library/Developer/Frameworks" \
		-Xlinker -rpath -Xlinker "$(DEVELOPER_PATH)/Library/Developer/usr/lib"

battery-probe: ## Read every connected device's battery once from the terminal (through the app's own reader, no React)
	swift run --package-path $(MACOS)/CoreTests juice-probe $(ARGS)

app-icon: ## Render the app icon from its Swift drawing into the asset catalog (CoreTests/Icon)
	swift run --package-path $(MACOS)/CoreTests juice-icon $(MACOS)/Juice-macOS/Assets.xcassets/AppIcon.appiconset

# The README's pictures (rule://root-readme): rendered from the widget's own
# views, so a changed widget is regenerated, never redrawn by hand.
widget-snapshots: ## Render docs/widgets-light.png and docs/widgets-dark.png from the widget's own views (requires macOS)
	swift run --package-path $(MACOS)/CoreTests juice-widget-snapshots docs

demo: ## Record docs/widgets.gif and docs/demo.gif — the widgets over a desk of made-up devices, then the desktop window on the same kind of desk (requires macOS, ffmpeg and `make desktop-install`)
	swift run --package-path $(MACOS)/CoreTests juice-widget-snapshots --demo docs/widgets.gif
	node app/desktop/demo.ts docs/demo.gif

# Windows and Linux (rule://root-makefile). Electron and electron-builder run on
# any OS, but an installer is built for the OS it runs on — CI builds both.
desktop-install: ## Install the Windows/Linux desktop app's dependencies (npm ci in app/desktop)
	cd $(DESKTOP) && npm ci

desktop-build: ## Bundle the Windows/Linux desktop app (main, preload, window) into app/desktop/out
	node app/desktop/build.ts

desktop-start: desktop-build ## Run the desktop app from its bundle (Windows/Linux; on macOS use `make run`)
	cd $(DESKTOP) && npx electron .

desktop-typecheck: ## Type-check the desktop app against DOM and Node types
	cd $(DESKTOP) && npx tsc --noEmit -p tsconfig.json

desktop-dist: desktop-build ## Package this OS's installers into app/desktop/release (usage: make desktop-dist v=x.y.z)
	cd $(DESKTOP) && npx electron-builder --publish never $(if $(v),-c.extraMetadata.version=$(v))

# Android (rule://root-makefile): the same screens on React Native; Bluetooth
# through the Kotlin module JuiceBluetooth (app/android). `make start` serves it.
android-apk: ## Build the Android APK, release-built and signed with the template's debug key (requires the Android SDK and JDK 17; v=x.y.z sets the version)
	cd $(APP)/android && ./gradlew assembleRelease $(if $(v),-PjuiceVersionName=$(v))

android-widget-preview: ## Draw the Android widget gallery's preview images, light and dark, from the widget's own drawing code (macOS: Quick Look and ffmpeg)
	node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON app/mobile/widgetPreview.mts

verify: lint typecheck test swift-check swift-test check-app-duplicate-blocks check-app-macos-project check-app-native-boundary check-code-layout check-makefiles check-omp-hooks check-omp-probes check-omp-rules check-omp-skills check-omp-types check-readme check-release check-tooling ## Run every gate that runs without Xcode

clean: ## Remove build output and caches (the Debug app is unregistered first, so nothing lists a deleted copy)
	-pluginkit -r "$(BUILT_APP)/Contents/PlugIns/JuiceWidget.appex" 2>/dev/null
	-$(LSREGISTER) -u "$(BUILT_APP)" 2>/dev/null
	rm -rf $(MACOS)/build $(MACOS)/CoreTests/.build $(APP)/coverage
	cd $(APP) && npx jest --clearCache >/dev/null

# Publishing stages the tree `verify` read: the `-- .` pathspec, from the repository root.
commit: verify ## Commit this project's verified changes (usage: make commit m="type(scope): subject")
	@test -n '$(m)' || { echo 'usage: make commit m="type(scope): subject"' >&2; exit 2; }
	@git add -A -- .
	@git commit -q -m '$(m)' -- .
	@git --no-pager log --oneline -1

push: verify ## Push the current branch after the gate passes
	@git push origin "$$(git rev-parse --abbrev-ref HEAD)"
	@git --no-pager log --oneline -1 "origin/$$(git rev-parse --abbrev-ref HEAD)"

# Releases (rule://release). The version is the git tag; the build is signed on
# this Mac, where the Apple Development identity and the Sparkle key live.
dist: ## Build, package and Sparkle-sign a Release into app/macos/build/dist without publishing (usage: make dist v=x.y.z; requires Xcode)
	node .omp/hooks/lib/app-release.ts dist $(v)

release: verify ## Tag, build, sign and publish the next GitHub release (usage: make release bump=patch|minor|major [DRY_RUN=1]; requires Xcode)
	node .omp/hooks/lib/app-release.ts release $(bump) $(if $(DRY_RUN),--dry-run)

unrelease: ## Delete a GitHub release and its tag (usage: make unrelease v=vX.Y.Z)
	node .omp/hooks/lib/app-release.ts unrelease $(v)

app-install: ## Install the published release into /Applications as the only registered Juice (build copies are unregistered)
	node .omp/hooks/lib/app-release.ts install

doctor: ## Report, read-only, every registered copy, the widget registration, the signing chain and the toolchain (exit 1 on a finding)
	node .omp/hooks/lib/app-doctor.ts

hook-report: ## Report what the hooks cost, which warnings were acted on and which pre hooks blocked how often (from .omp/state/hook-metrics.jsonl)
	node .omp/hooks/lib/hook-metrics.ts

# Harness checks — one target per .omp/hooks/post/ hook (rule://root-makefile).
# Every one is a `verify` prerequisite except check-verify, which runs `verify`.
check-app-duplicate-blocks: ## Check app/ sources for duplicated block runs (stale rewrite + partial edits)
	node .omp/hooks/post/check-app-duplicate-blocks.ts

check-app-macos-project: ## Check the Xcode project (target membership, team signing, App Group, names, Bluetooth usage, menu bar residency)
	node .omp/hooks/post/check-app-macos-project.ts

check-app-native-boundary: ## Check the React Native ↔ Swift boundary (React-free battery engine/shared snapshot/widget, thin adapters)
	node .omp/hooks/post/check-app-native-boundary.ts

check-code-layout: ## Check code layout (comments, TS file layout, member order, whitespace)
	node .omp/hooks/post/check-code-layout.ts

check-makefiles: ## Check Makefile targets against root-makefile.md and the post hooks
	node .omp/hooks/post/check-makefiles.ts

check-omp-hooks: ## Check .omp/hooks/ against omp-hooks.md and the hook contract
	node .omp/hooks/post/check-omp-hooks.ts

check-omp-probes: ## Run the pre hooks' probe table (.omp/hooks/probes.json) and compare every verdict
	node .omp/hooks/post/check-omp-probes.ts

check-omp-rules: ## Check .omp/rules/ frontmatter, naming and TTSR triggers
	node .omp/hooks/post/check-omp-rules.ts

check-omp-skills: ## Check the skills catalog against the discovered SKILL.md files
	node .omp/hooks/post/check-omp-skills.ts

check-omp-types: ## Type-check the harness TypeScript (.omp/**/*.ts)
	node .omp/hooks/post/check-omp-types.ts

check-readme: ## Check the README's links, make targets and docs/ pictures, and that the demo desk reaches no shipped build
	node .omp/hooks/post/check-readme.ts

check-release: ## Check the update feed, Sparkle keys, version and release asset names agree
	node .omp/hooks/post/check-release.ts

check-tooling: ## Check the tooling language policy (TypeScript + Swift only, no scripts)
	node .omp/hooks/post/check-tooling.ts

check-verify: ## Run the root make verify and quote the failing lines
	node .omp/hooks/post/check-verify.ts
