extends SceneTree

var _failures := 0


func _initialize() -> void:
	root.unfocusable = true
	create_timer(50).timeout.connect(func() -> void:
		push_error("LATEST_ANDROID_SMOKE timed out")
		quit(2)
	)
	_run.call_deferred()


func _run() -> void:
	var settings := ConfigFile.new()
	settings.set_value("accessibility", "reduced_motion", true)
	settings.set_value("audio", "music_volume", 0.0)
	settings.set_value("audio", "sfx_volume", 0.0)
	_check(settings.save("user://menu_settings.cfg") == OK, "Isolated settings are writable")
	_check(Input.emulate_mouse_from_touch, "Touch input is enabled")
	_check(not quit_on_go_back, "Back does not quit automatically")
	_check(ResourceLoader.exists(str(ProjectSettings.get_setting("application/run/main_scene"))), "Latest startup scene is included")
	var runtime := root.get_node("AndroidRuntime")
	_check(is_instance_valid(runtime), "Android runtime is included")
	change_scene_to_file("res://scenes/ui/MainMenu.tscn")
	await _settle()
	runtime.handle_back()
	await _settle()
	_check(current_scene.get_node("ModalLayer").visible, "Back opens exit confirmation")
	await _back(runtime)
	_check(not current_scene.get_node("ModalLayer").visible, "Back closes exit confirmation")
	await _tap("Design/Navigation/SettingsButton")
	_check(current_scene.get("_page") == "settings", "Touch opens settings")
	await _back(runtime)
	_check(current_scene.get("_page") == "home", "Back returns from settings")
	await _tap("Design/Navigation/TutorialButton")
	_check(current_scene.name == "Tutorial", "Latest tutorial opens")
	await _back(runtime)
	_check(current_scene.name == "MainMenu", "Back returns from tutorial")
	await _tap("Design/StartButton")
	await _tap("Design/ModeSelection/ClassicButton")
	await _tap("Design/TacticalVariants/ConfirmButton")
	_check(current_scene.name == "BattlePreparation", "Touch opens duel preparation")
	await _tap("Design/StartButton")
	_check(current_scene.name == "BattleScene" and current_scene.get("battle_manager") != null, "Latest duel starts")
	await _back(runtime)
	_check(current_scene.get("_menu_overlay").visible, "Back opens the current duel settings")
	change_scene_to_file("res://scenes/ui/MainMenu.tscn")
	await _settle()
	if current_scene.get("_page") != "modes": current_scene.call("_show_modes")
	await _tap("Design/ModeSelection/KingdomButton")
	_check(current_scene.name == "KingdomSetup", "Touch opens Kingdom setup")
	await _tap("Design/Variants/ConfirmButton")
	_check(current_scene.name == "BattlePreparation", "Kingdom confirms into opponent selection")
	await _tap("Design/StartButton")
	_check(current_scene.name == "KingdomBattle" and current_scene.get("model") != null, "Latest Kingdom starts")
	await _back(runtime)
	_check(current_scene.get("_modal").visible, "Back opens Kingdom settings")
	current_scene.free()
	root.get_node("MusicManager").free()
	await create_timer(0.2).timeout
	print("LATEST_ANDROID_SMOKE: ", "PASS" if _failures == 0 else "FAIL")
	quit(0 if _failures == 0 else 1)


func _tap(path: String) -> void:
	var button := current_scene.get_node(path) as Control
	_check(button.is_visible_in_tree(), "Touch target visible: " + path)
	var point := root.get_final_transform() * button.get_global_rect().get_center()
	for down in [true, false]:
		var event := InputEventScreenTouch.new()
		event.index = 0
		event.position = point
		event.pressed = down
		Input.parse_input_event(event)
		await process_frame
	await _settle()


func _back(runtime: Node) -> void:
	await create_timer(0.3).timeout
	runtime.handle_back()
	await _settle()


func _settle() -> void:
	await create_timer(0.35).timeout
	await process_frame


func _check(value: bool, label: String) -> void:
	if value:
		print("LATEST_ANDROID_SMOKE: ", label)
	else:
		_failures += 1
		push_error("LATEST_ANDROID_SMOKE: " + label)
