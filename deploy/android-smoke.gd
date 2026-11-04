extends SceneTree

const LAYOUT := preload("res://scripts/ui/screen_layout.gd")
const SOUND_LIBRARY := preload("res://scripts/audio/sound_library.gd")
const PROTOCOL := preload("res://scripts/network/lan_protocol.gd")
var _failures := 0


func _initialize() -> void:
	root.unfocusable = true
	create_timer(50).timeout.connect(func() -> void:
		push_error("LATEST_ANDROID_SMOKE timed out")
		quit(2)
	)
	_run.call_deferred()


func _run() -> void:
	_check(ProjectSettings.get_setting("display/window/stretch/aspect") == "expand", "Android supports the device aspect ratio")
	LAYOUT.content_zoom = 1.035
	root.size = Vector2i(2400, 1080)
	var settings := ConfigFile.new()
	settings.set_value("accessibility", "reduced_motion", true)
	settings.set_value("audio", "music_volume", 0.0)
	settings.set_value("audio", "sfx_volume", 0.0)
	_check(settings.save("user://menu_settings.cfg") == OK, "Isolated settings are writable")
	_check(Input.emulate_mouse_from_touch, "Touch input is enabled")
	_check(not quit_on_go_back, "Back does not quit automatically")
	_check(ResourceLoader.exists(str(ProjectSettings.get_setting("application/run/main_scene"))), "Latest startup scene is included")
	for id in SOUND_LIBRARY.DEFINITIONS:
		var stream := load(SOUND_LIBRARY.asset_path(id)) as AudioStream
		_check(stream != null and stream.get_length() > 0.0, "Packaged sound loads: " + id)
	var runtime := root.get_node("AndroidRuntime")
	_check(is_instance_valid(runtime), "Android runtime is included")
	change_scene_to_file("res://scenes/ui/MainMenu.tscn")
	await _settle()
	_check(current_scene.get_node("_Letterbox").get_global_rect().grow(1).encloses(root.get_visible_rect()), "Android retains a black matte around the frame")
	_check(current_scene.get_node("Design").scale.x > 1.0, "Mobile content uses proportional zoom")
	runtime.handle_back()
	await _settle()
	_check(current_scene.get_node("ModalLayer").visible, "Back opens exit confirmation")
	await _back(runtime)
	_check(not current_scene.get_node("ModalLayer").visible, "Back closes exit confirmation")
	await _tap("Design/Navigation/SettingsButton")
	_check(current_scene.get("_page") == "settings", "Touch opens settings")
	await _tap_control(current_scene.settings_view.get_control("AboutAuthorButton"))
	var profile: Control = current_scene.modal_content.get_node("AuthorProfile")
	_check(profile.get_node("GameWebsiteButton/CopyHint").text == "复制", "Packaged author links identify the copy action")
	await _tap_control(current_scene.modal_footer.get_node("ThirdPartyNotices"))
	var notices: CanvasLayer = current_scene.get("_third_party_view")
	_check(is_instance_valid(notices) and notices._sections.size() == 5 and not notices._paper.has_node("Section_sources"), "Packaged notices omit asset sources")
	await _back(runtime)
	_check(not is_instance_valid(current_scene.get("_third_party_view")) and current_scene.modal_layer.visible, "Android Back closes notices while preserving the author page")
	await _back(runtime)
	_check(not current_scene.modal_layer.visible and current_scene.get("_page") == "settings", "Android Back closes author page")
	await _back(runtime)
	_check(current_scene.get("_page") == "home", "Back returns from settings")
	await _tap("Design/LanButton")
	_check(current_scene.scene_file_path == "res://scenes/network/LanLobby.tscn", "Packaged LAN lobby opens by touch")
	var session: Node = root.get_node("LanSession")
	_check(session.host_room("Android package QA", 24588) == OK, "Packaged LAN host can bind a room")
	await _settle()
	await _tap_control(current_scene._family)
	_check(current_scene._picker.visible, "Touch opens packaged LAN mode picker")
	await _back(runtime)
	_check(current_scene.scene_file_path == "res://scenes/network/LanLobby.tscn" and not current_scene._picker.visible and session.state == "hosting", "Android Back dismisses the picker without leaving the room")
	for family in PROTOCOL.FAMILIES:
		session.room.players[1].caps[family].modes = ["standard", "advanced", "expert"]
		session.room.players[1].caps[family].roles = PROTOCOL.PROGRESS.role_ids()
		session.room.players[1].caps[family].specials = PROTOCOL.PROGRESS.pool_ids("special", family)
	session.set_rules("tactical", "expert")
	await _tap_control(current_scene._role)
	_check(current_scene._picker._cards.size() == 12, "Packaged role picker includes collected characters and random")
	await _tap_control(current_scene._picker._grid.get_node("Choice_wizard"))
	_check(current_scene._picker._preview.get_node("DetailTitle").text == "秘术", "Packaged role selection previews its actual ability")
	await _tap_control(current_scene._picker._confirm)
	_check(session.room.players[1].role == "wizard", "Touch confirms a packaged LAN character")
	await _back(runtime)
	_check(current_scene.name == "MainMenu" and session.state == "offline", "Android Back leaves the lobby and releases the network session")
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
	await root.get_node("MusicManager").shutdown()
	current_scene.free()
	root.get_node("MusicManager").free()
	await create_timer(0.2).timeout
	print("LATEST_ANDROID_SMOKE: ", "PASS" if _failures == 0 else "FAIL")
	quit(0 if _failures == 0 else 1)


func _tap(path: String) -> void:
	var button := current_scene.get_node(path) as Control
	await _tap_control(button)


func _tap_control(button: Control) -> void:
	_check(button.is_visible_in_tree(), "Touch target visible: " + str(button.name))
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
