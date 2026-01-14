

<!-- Page 1 -->

## Electrostatics

### Electric Field $\vec{E}$

The electric field is a vector field that describes the electrical force experienced by a unit positive charge at any point in space.

*   **Definition**: The electric field $\vec{E}$ at a point is defined as the force $\vec{F}$ per unit positive charge $q_0$ placed at that point.
    $$ \vec{E} = \frac{\vec{F}}{q_0} $$

### Electric Field Due to a Point Charge

For a point charge $q$, the electric field at a distance $r$ is given by:
$$ \vec{E} = k \frac{q}{r^2} \hat{r} $$
where:
*   $k$ is Coulomb's constant ($k = \frac{1}{4\pi\epsilon_0}$)
*   $\epsilon_0$ is the permittivity of free space
*   $\hat{r}$ is the unit vector pointing radially outward from the charge.

### Electric Field Due to a System of Point Charges

For a system of $N$ point charges $q_1, q_2, ..., q_N$ located at positions $\vec{r}_1, \vec{r}_2, ..., \vec{r}_N$, the electric field at a point $\vec{r}$ is the vector sum of the electric fields due to each individual charge (superposition principle).
$$ \vec{E} = \sum_{i=1}^{N} k \frac{q_i}{|\vec{r} - \vec{r}_i|^2} \frac{\vec{r} - \vec{r}_i}{|\vec{r} - \vec{r}_i|} $$

### Electric Field Lines

Electric field lines are imaginary lines that represent the direction of the electric field.
*   They originate from positive charges and terminate on negative charges.
*   The density of the lines indicates the strength of the electric field.
*   Field lines never cross each other.

[DIAGRAM: Sketch of electric field lines originating from a positive point charge and terminating on a negative point charge, showing outward radial lines from the positive charge and inward radial lines to the negative charge.]

### Electric Dipole

An electric dipole consists of two equal and opposite charges separated by a small distance.

*   The dipole moment $\vec{p}$ is defined as:
    $$ \vec{p} = q\vec{d} $$
    where $q$ is the magnitude of the charge and $\vec{d}$ is the vector pointing from the negative to the positive charge.

*   The electric field of a dipole falls off as $1/r^3$ at large distances.

### Gauss's Law

Gauss's law relates the electric flux through a closed surface to the enclosed charge.

*   **Statement**: The total electric flux $\Phi_E$ through any closed surface is proportional to the total electric charge $Q_{enc}$ enclosed within that surface.
    $$ \Phi_E = \oint \vec{E} \cdot d\vec{A} = \frac{Q_{enc}}{\epsilon_0} $$

Gauss's law is particularly useful for calculating the electric field of charge distributions with high symmetry (spherical, cylindrical, planar).

#### Application: Electric Field of a Uniformly Charged Sphere

For a uniformly charged sphere of radius $R$ and total charge $Q$:

*   **Outside the sphere ($r > R$)**: The electric field is the same as that of a point charge $Q$ located at the center.
    $$ \vec{E} = k \frac{Q}{r^2} \hat{r} $$

*   **Inside the sphere ($r < R$)**: The electric field depends on the charge enclosed within a radius $r$.
    $$ \vec{E} = k \frac{Qr}{R^3} \hat{r} $$

[DIAGRAM: Cross-section of a uniformly charged sphere, showing a Gaussian surface inside and outside.]