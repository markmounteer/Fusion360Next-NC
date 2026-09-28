# Implementation references

The implementation is original. These public primary references informed the data model and API use; their code and schema files are not redistributed here.

- [Autodesk post entry functions](https://cam.autodesk.com/posts/reference/entry_functions.html): section and motion callbacks, unsupported-event boundaries.
- [Autodesk Tool API](https://cam.autodesk.com/posts/reference/classTool.html): spindle, CSS, tool and offset values.
- [Autodesk Section API](https://cam.autodesk.com/posts/reference/classSection.html): operation type, feed mode, initial position, WCS and work plane.
- [Autodesk PostProcessor API](https://cam.autodesk.com/posts/reference/classPostProcessor.html): circular geometry and frame handling.
- [Autodesk Post Library management](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-ADD-POST-PROCESSOR-TO-LIBRARY.htm): importing the CPS.
- [STEP Tools AP238 technical resources](https://www.steptools.com/stds/stepnc/tech_resources/): published AIM EXPRESS reference, including the 2011-12-06 second-edition development schema named `integrated_cnc_schema`.
- [STEP Tools toolpath example](https://downloads.steptools.com/docs/stp_aim/demos/toolpath.html): relationships between a machining project, workplan, workingsteps, tools and cutter-location paths.
- STEP Tools [polyline](https://downloads.steptools.com/docs/stp_aim/html/t_polyline.html), [trimmed curve](https://downloads.steptools.com/docs/stp_aim/html/t_trimmed_curve.html), and [3D placement](https://downloads.steptools.com/docs/stp_aim/html/t_axis2_placement_3d.html): geometry definitions and reference attributes, distinct from ordered machining toolpath actions.
- [Machining operation](https://downloads.steptools.com/docs/stp_aim/html/t_machining_operation.html) and [workingstep](https://downloads.steptools.com/docs/stp_aim/html/t_machining_workingstep.html): required operation/resource/process links.
- [Toolpath](https://downloads.steptools.com/docs/stp_aim/html/t_machining_toolpath.html), [technology](https://downloads.steptools.com/docs/stp_aim/html/t_machining_technology.html), [feed](https://downloads.steptools.com/docs/stp_aim/html/t_machining_feed_speed_representation.html), [spindle](https://downloads.steptools.com/docs/stp_aim/html/t_machining_spindle_speed_representation.html) and [functions](https://downloads.steptools.com/docs/stp_aim/html/t_machining_functions.html): standard property/representation mappings.
- [STEP Tools Adaptive API](https://downloads.steptools.com/docs/stepnc_api/Adaptive.html), `GetMoveSpindle`: right-handed spindle-speed sign convention.
- [LinuxCNC INI configuration](https://linuxcnc.org/docs/stable/html/config/ini-config.html): interpreter selection and controller-owned configuration.

AP238 is not the same as a normal CAD STEP/AP203/AP214/AP242 geometry export. This project does not claim that Fusion's standard CAD STEP export contains machining workingsteps, or that a standard LinuxCNC installation reads AP238.
