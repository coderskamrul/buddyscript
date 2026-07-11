/** The decorative background shapes shared by the login and registration pages. */
export default function AuthShapes() {
  return (
    <>
      <div className="_shape_one">
        <img src="/assets/images/shape1.svg" alt="" className="_shape_img" />
        <img src="/assets/images/dark_shape.svg" alt="" className="_dark_shape" />
      </div>
      <div className="_shape_two">
        <img src="/assets/images/shape2.svg" alt="" className="_shape_img" />
        <img src="/assets/images/dark_shape1.svg" alt="" className="_dark_shape _dark_shape_opacity" />
      </div>
      <div className="_shape_three">
        <img src="/assets/images/shape3.svg" alt="" className="_shape_img" />
        <img src="/assets/images/dark_shape2.svg" alt="" className="_dark_shape _dark_shape_opacity" />
      </div>
    </>
  );
}

/** Inline field error, styled to sit under the design's inputs. */
export function FieldError({ children }) {
  if (!children) return null;
  return (
    <p
      className="bs-ui"
      role="alert"
      style={{ color: '#d93025', fontSize: 12, margin: '6px 0 0', lineHeight: 1.4 }}
    >
      {children}
    </p>
  );
}

/** Form-level error banner (bad credentials, email taken, server down). */
export function FormError({ children }) {
  if (!children) return null;
  return (
    <div
      className="bs-ui _mar_b14"
      role="alert"
      style={{
        background: 'rgba(217, 48, 37, 0.08)',
        border: '1px solid rgba(217, 48, 37, 0.25)',
        color: '#d93025',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
