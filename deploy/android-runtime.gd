extends Node

var _last_back_msec := -1000


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().quit_on_go_back = false


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		handle_back()


func handle_back() -> void:
	var now := Time.get_ticks_msec()
	if now - _last_back_msec < 250: return
	_last_back_msec = now
	var scene := get_tree().current_scene
	if not is_instance_valid(scene): return
	var event := InputEventKey.new()
	event.keycode = KEY_ESCAPE
	event.physical_keycode = KEY_ESCAPE
	event.pressed = true
	if scene.scene_file_path == "res://scenes/ui/MainMenu.tscn" and not is_instance_valid(scene.get("_developer_dialog")):
		if scene.get("_page") == "home" and not scene.get_node("ModalLayer").visible:
			scene.call("_show_exit_confirmation")
			return
	# Paused tutorials and developer dialogs own their input independently.
	if not is_instance_valid(scene.get("_tutorial_layer")) and not is_instance_valid(scene.get("_developer_dialog")) and scene.has_method("_unhandled_key_input"):
		scene.call("_unhandled_key_input", event)
		return
	Input.parse_input_event(event)
	event = event.duplicate()
	event.pressed = false
	Input.parse_input_event(event)
