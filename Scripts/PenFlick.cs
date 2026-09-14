using Godot;

public partial class PenFlick : RigidBody3D
{
	[Export] public NodePath CameraPath;

	[Export] public float PowerMultiplier = 2.0f;

	[Export] public float MaxImpulse = 4.0f;

	[Export] public float TablePlaneY = 0.2f;

	private Camera3D _camera;

	private bool _dragging = false;

	private Vector3 _dragStartWorld;
	private Vector3 _dragCurrentWorld;


	public override void _Ready()
	{
		_camera = GetNode<Camera3D>(CameraPath);
	}


	public override void _UnhandledInput(InputEvent @event)
	{
		// Left mouse button
		if (@event is InputEventMouseButton mouseButton &&
			mouseButton.ButtonIndex == MouseButton.Left)
		{
			if (mouseButton.Pressed)
			{
				TryStartDrag(mouseButton.Position);
			}
			else if (_dragging)
			{
				ReleaseDrag();
			}
		}

		// Mouse movement while dragging
		else if (@event is InputEventMouseMotion mouseMotion && _dragging)
		{
			Vector3? worldPosition = MouseToTablePlane(mouseMotion.Position);

			if (worldPosition.HasValue)
			{
				_dragCurrentWorld = worldPosition.Value;
			}
		}
	}


	// ---------------------------------------------------------
	// START DRAG
	// ---------------------------------------------------------

	private void TryStartDrag(Vector2 mousePosition)
	{
		// Create a ray from the camera through the mouse position.
		Vector3 rayOrigin = _camera.ProjectRayOrigin(mousePosition);
		Vector3 rayDirection = _camera.ProjectRayNormal(mousePosition);

		Vector3 rayEnd = rayOrigin + rayDirection * 100.0f;

		// Perform a physics raycast.
		var spaceState = GetWorld3D().DirectSpaceState;

		var query = PhysicsRayQueryParameters3D.Create(
			rayOrigin,
			rayEnd
		);

		var result = spaceState.IntersectRay(query);

		// Did the ray hit something?
		if (result.Count == 0)
		{
			return;
		}

		// Get the object that was hit.
		Node collider = result["collider"].As<Node>();

		// Only start dragging if the object hit was this pen.
		if (collider != this)
		{
			return;
		}

		// Convert mouse position into a point on the table.
		Vector3? worldPosition = MouseToTablePlane(mousePosition);

		if (!worldPosition.HasValue)
		{
			return;
		}

		_dragging = true;

		_dragStartWorld = worldPosition.Value;
		_dragCurrentWorld = _dragStartWorld;

		GD.Print("Drag started");
	}


	// ---------------------------------------------------------
	// MOUSE → TABLE POSITION
	// ---------------------------------------------------------

	private Vector3? MouseToTablePlane(Vector2 mousePosition)
	{
		Vector3 rayOrigin = _camera.ProjectRayOrigin(mousePosition);
		Vector3 rayDirection = _camera.ProjectRayNormal(mousePosition);

		// If the ray is almost parallel to the table,
		// it won't properly intersect the table plane.
		if (Mathf.Abs(rayDirection.Y) < 0.0001f)
		{
			return null;
		}

		// We want:
		//
		// rayOrigin.Y + t * rayDirection.Y = TablePlaneY
		//
		// Therefore:
		//
		// t = (TablePlaneY - rayOrigin.Y) / rayDirection.Y

		float t = (TablePlaneY - rayOrigin.Y) / rayDirection.Y;

		// If the intersection is behind the camera,
		// don't use it.
		if (t < 0)
		{
			return null;
		}

		return rayOrigin + rayDirection * t;
	}


	// ---------------------------------------------------------
	// RELEASE DRAG
	// ---------------------------------------------------------

	private void ReleaseDrag()
	{
		_dragging = false;

		// Calculate the direction from the current mouse position
		// BACK toward where the drag started.
		//
		// This creates the slingshot/pull-back mechanic.
		Vector3 dragVector = _dragStartWorld - _dragCurrentWorld;

		// We only want movement across the table.
		// Ignore Y completely.
		Vector3 flatDrag = new Vector3(
			dragVector.X,
			0,
			dragVector.Z
		);

		// Convert the drag distance into an impulse.
		Vector3 impulse = flatDrag * PowerMultiplier;

		// Prevent the pen from receiving an excessively large impulse.
		if (impulse.Length() > MaxImpulse)
		{
			impulse = impulse.Normalized() * MaxImpulse;
		}

		GD.Print("Drag released");
		GD.Print("Impulse: ", impulse);
		GD.Print("Impulse strength: ", impulse.Length());

		// Apply the force to the pen.
		ApplyCentralImpulse(impulse);
	}
}
